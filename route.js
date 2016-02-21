var url = require('url');
var path = require('path');
var request = require('request');
var http = require('http');
var URLValidator = require('valid-url');
var cheerio = require('cheerio');
var iconv = require('iconv-lite');
var characterDetector = require('jschardet');

var server = http.createServer();

server.on('request', function (req, res) {
    var proxyHost = req.headers.host;
    var proxyURL = req.url;
	var forwardURL = getForwardURL(req, proxyURL);
    if (forwardURL == null) {
        res.writeHead(404);
        res.end('114514');
    } else {
        respondResource(req, res, forwardURL);
    }
});

function getForwardURL(req, proxyURL) {
    if (typeof proxyURL != 'string') return null; // Error('The first parameter must be string.');
    if (proxyURL[0] != '/') return null; // Error('The first letter must be "/".');
    var forwardURL = '';
    if (proxyURL.substr(0, 5) == '/http') {
	   forwardURL = decodeURIComponent(unescape(proxyURL.substr(1)));
    } else if (req.headers.referer) {
        var refererObject = url.parse(req.headers.referer);
        var refererURL = decodeURIComponent(refererObject.path.substr(1));
        refererObject = url.parse(refererURL);
        forwardURL = url.resolve(refererObject.protocol + '//' + refererObject.host, proxyURL);
    }
    
    if (URLValidator.isWebUri(forwardURL)) {
		return forwardURL;
	} else {
		return null; // Error('The parameter "' + forwardURL  + '" is not web uri.');
	}
}

function mustBeReplaced(contentType) {
    if (typeof contentType != 'string') return false;
    return [
        contentType.match('text/html'),
        contentType.match('text/css')
    ].some(function (match) {
        return match != null;
    });
}

function respondResource(req, res, forwardURL) {
    var options = {
		method: req.method,
		uri: forwardURL,
        encoding: null,
        headers: {
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.109 Safari/537.36'
        }
	};
    
	var forward = request(options, function onResponseEnd(error, response, body) {
        if (error) { console.error(error); return }
        var convertedText = '';
        var contentType = response.headers['content-type'] || '';
        if (contentType.match('text/html')) {
            body = iconv.decode(body, characterDetector.detect(body).encoding || 'utf-8');
            convertedText = convertURLOnHTML(req.headers.host, url.parse(forwardURL), body);
        } else if (contentType.match('text/css')) {
            body = iconv.decode(body, characterDetector.detect(body).encoding || 'utf-8');
            convertedText = convertURLOnCSS(req.headers.host, url.parse(forwardURL), body);
        }
        
        if (convertedText) {
            if (!res.headersSent) {
                res.setHeader('Content-Length', Buffer.byteLength(convertedText, 'binary'));
            }
			res.end(convertedText);
		}
    });
    
	forward.on('response', function onReceiveResponse(response) {
		var contentType = response.headers['content-type'] || '';
        for (var name in response.headers) res.setHeader(name, response.headers[name]);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Security-Policy', 'connect-src *');
        
        if (!mustBeReplaced(contentType)) {
            forward.pipe(res);
        }
	});
}

var clientCodes = require('./clientCodeFactory');

function getURLPropertyName(tagName) {
    if (tagName == 'a' || tagName == 'link' || tagName == 'button') {
        return 'href';
    } else if (tagName == 'script' || tagName == 'img' || tagName == 'iframe' || tagName == 'frame') {
        return 'src';
    } else if (tagName == 'form') {
        return 'action';
    } else if (tagName == 'body') {
        return 'background';
    }
}

function convertURLOnHTML(proxyHost, forwardURLObject, html) {
	var forwardURLPrefix = 'http://' + proxyHost + '/';
    var clientScript = clientCodes.defineSetter + clientCodes.overrideXHR(forwardURLPrefix);
    
    var $ = cheerio.load(html);
    $('head').prepend($('<script>').text(clientScript));
    $('a, link, button, script, img, iframe, frame, form, body').each(function () {
        var prop = getURLPropertyName(this.tagName);
        if (!this.attribs[prop]) return;
        var value = this.attribs[prop].trim();
        if (URLValidator.isWebUri(value)) {
            this.attribs[prop] = forwardURLPrefix + encodeURIComponent(value);
		} else {
            if (value[0] == '#') return;
            if (value.substr(0, 10) == 'javascript') return;
			if (value.substr(0, 2) == '//') {
				this.attribs[prop] = forwardURLPrefix + encodeURIComponent(forwardURLObject.protocol + value);
			} else {
				this.attribs[prop] = forwardURLPrefix + encodeURIComponent(url.resolve(forwardURLObject.href, value));
			}
        }
    });
    
	return $.html();
}

function convertURLOnCSS(proxyHost, forwardURLObject, css) {
    var forwardURLPrefix = 'http://' + proxyHost + '/';
    var reg = /url\((['"])?([^']*?)(['"])?\)/g;
    css = css.replace(reg, function (entireCssURL, quoteStart, cssURL, quoteEnd) {
        quoteStart = quoteStart || '';
        quoteEnd = quoteEnd || '';
        var forwardCssURL = '';
        if (URLValidator.isWebUri(cssURL)) {
            forwardCssURL = 'url(' + quoteStart + forwardURLPrefix + encodeURIComponent(cssURL) + quoteEnd + ')';
        } else {
            if (cssURL.substr(0, 5) == 'data:') {
                forwardCssURL = 'url(' + quoteStart + cssURL + quoteEnd + ')';  
            } else if (cssURL.substr(0, 2) == '//') {
				forwardCssURL = 'url(' + quoteStart + forwardURLPrefix + encodeURIComponent(forwardURLObject.protocol + cssURL) + quoteEnd + ')';
			} else {
				forwardCssURL = 'url(' + quoteStart + forwardURLPrefix + encodeURIComponent(url.resolve(forwardURLObject.href, cssURL)) + quoteEnd + ')';
			}
        }
        console.log(forwardCssURL);
        return forwardCssURL;
    });
    return css;
}

server.listen(3015);