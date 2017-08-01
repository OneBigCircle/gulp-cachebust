var crypto = require('crypto');
var through2 = require('through2');
var gutil = require('gulp-util');
var path = require('path');
var slash = require('slash');
var PluginError = gutil.PluginError;

module.exports = CacheBuster;

function CacheBuster(options) {
    if (!(this instanceof CacheBuster)) {
        return new CacheBuster(options);
    }

    this.checksumLength = (options && options.checksumLength) || 8;
    this.random = (options && options.random) || false;
    if (this.random) {
        var shasum = crypto.createHash('sha1');
        shasum.update(crypto.randomBytes(50).toString());
        this.hash =  shasum.digest('hex').substr(0, this.checksumLength);
    }

    this.pathFormatter = options && options.pathFormatter ? options.pathFormatter : function(dirname, basename, extname, checksum) {
        return path.join(dirname, basename + '.' + checksum + extname);
    };

    this.mappings = {
        baseDir: null,
        values: {}
    };
}

CacheBuster.prototype.getChecksum = function getChecksum(file) {
    var hash = crypto.createHash('md5');

    if (file.isNull()) {
        return;
    }

    if (file.isStream()) {
        file.pipe(hash);
        hash.end();
    }

    if (file.isBuffer()) {
        hash.end(file.contents);
    }

    return hash.read().toString('hex').substr(0, this.checksumLength);
}

CacheBuster.prototype.getBustedPath = function getBustedPath(file) {
    var checksum = this.random ? this.hash : this.getChecksum(file);

    if (!checksum) {
        return file.path;
    }

    var extname = path.extname(file.path);
    var basename = path.basename(file.path, extname);
    var dirname = path.dirname(file.path);

    return slash(this.pathFormatter(dirname, basename, extname, checksum));
};

CacheBuster.prototype.getRelativeMappings = function getRelativeMappings(relativePath) {
    var mappings = [];

    for (var original in this.mappings.values) {
        var cachebusted = this.mappings.values[original];

        mappings.push({
            original: path.relative(relativePath, path.join(this.mappings.baseDir, original)),
            cachebusted: path.relative(relativePath, path.join(this.mappings.baseDir, cachebusted))
        });
    }

    return mappings;
};

CacheBuster.prototype.resources = function resources() {
    var cachebuster = this;

    return through2.obj(function transform(file, encoding, callback) {
        var bustedPath = cachebuster.getBustedPath(file);

        if (cachebuster.mappings.baseDir === null) {
            cachebuster.mappings.baseDir = file.base;
        }

        if (file.path === bustedPath) {
            this.push(file);
            return callback();
        }

        var original = slash(file.relative);
        file.path = bustedPath;

        cachebuster.mappings.values[original] = slash(file.relative);

        this.push(file);
        return callback();
    });
};

CacheBuster.prototype.references = function references(basePath) {
    var cachebuster = this;

    return through2.obj(function transform(file, encoding, callback) {
        if (file.isNull()) {
            this.push(file);
            return callback();
        }

        if (!file.isBuffer()) {
            this.emit('error', new PluginError('gulp-cachebust', 'Non buffer files are not supported for reference rewrites.'));
            this.push(file);
            return callback();
        }

        var contents = file.contents.toString(encoding);
        var mappings = cachebuster.getRelativeMappings(file.dirname);
        for (var i=0; i < mappings.length; i++) {
            var original = mappings[i].original;
            var cachebusted = mappings[i].cachebusted;

            contents = contents.replace(new RegExp('(["\'])' + original + '(?!\\.)\\b', 'g'), "$1" + cachebusted);
        }

        file.contents = new Buffer(contents, encoding);
        this.push(file);
        return callback();
    });
};
