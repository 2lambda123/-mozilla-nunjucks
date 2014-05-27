var Loader = require('./loader');

var WebLoader = Loader.extend({
    init: function(baseURL, neverUpdate, defaultExt) {
        // It's easy to use precompiled templates: just include them
        // before you configure nunjucks and this will automatically
        // pick it up and use it
        this.precompiled = window.nunjucksPrecompiled || {};

        this.baseURL = baseURL || '';
        this.neverUpdate = neverUpdate;

        // set defaultExt in format of '.ext' if passed, otherwise use '.html'
        defaultExt = (typeof(defaultExt) === 'string' && defaultExt.length) ? defaultExt : '.html';
        defaultExt = defaultExt[0] === '.' ? defaultExt : '.'.concat(defaultExt);
        this.defaultExt = defaultExt;
    },

    getSource: function(name) {
        if(this.precompiled[name]) {
            return {
                src: { type: "code",
                       obj: this.precompiled[name] },
                path: name
            };
        }
        else {
            var paths = [
                this.baseURL + '/' + name,
                this.baseURL + '/' + name + defaultExt
            ];

            var test = function(path) {
                var src = this.fetch(path);
                if (!src) {
                    return null;
                }
                return {
                    src: src,
                    path: path
                };
            };

            // Test both name AND name + defaultExt for fetch success
            var success = lib.firstof(paths, test);
            if(!success) {
                return null;
            }

            return { src: success.src,
                     path: success.path,
                     noCache: !this.neverUpdate };
        }
    },

    fetch: function(url, callback) {
        // Only in the browser please
        var ajax;
        var loading = true;
        var src;

        if(window.XMLHttpRequest) { // Mozilla, Safari, ...
            ajax = new XMLHttpRequest();
        }
        else if(window.ActiveXObject) { // IE 8 and older
            ajax = new ActiveXObject("Microsoft.XMLHTTP");
        }

        ajax.onreadystatechange = function() {
            if(ajax.readyState === 4 && (ajax.status === 0 || ajax.status === 200) && loading) {
                loading = false;
                src = ajax.responseText;
            }
        };

        url += (url.indexOf('?') === -1 ? '?' : '&') + 's=' +
               (new Date().getTime());

        // Synchronous because this API shouldn't be used in
        // production (pre-load compiled templates instead)
        ajax.open('GET', url, false);
        ajax.send();

        return src;
    }
});

module.exports = {
    WebLoader: WebLoader
};
