/*
 * Copyright (c) 2015
 *
 * This file is licensed under the Affero General Public License version 3
 * or later.
 *
 * See the COPYING-README file.
 *
 */

(function() {

	var FileInfo = function(data) {
		this.path = data.path;
		this.mtime = data.mtime;
		this.etag = data.etag;
		this.permissions = data.permissions;
		this.size = data.size;
		this.mime = data.mime;
		this._props = data._props;
	};

	FileInfo.prototype = {
	};

	/**
	 * @class Client
	 * @classdesc
	 *
	 * @param {Object} options
	 * @param {String} options.host host name
	 * @param {int} [options.port] port
	 * @param {boolean} [useHTTPS] whether to use https 
	 * @param {String} [options.root] root path
	 */
	var Client = function(options) {
		this._root = options.root;

		this.client = new nl.sara.webdav.Client(options);
	};

	Client.NS_OWNCLOUD = 'http://owncloud.org/ns';
	Client.NS_DAV = 'DAV:';
	Client._PROPFIND_PROPERTIES = [
		[Client.NS_DAV, 'getlastmodified'],
		[Client.NS_DAV, 'getetag'],
		[Client.NS_DAV, 'getcontenttype'],
		[Client.NS_DAV, 'resourcetype'],
		[Client.NS_OWNCLOUD, 'permissions'],
		//[Client.NS_OWNCLOUD, 'downloadURL'],
		[Client.NS_OWNCLOUD, 'size']
	];

	/**
	 * @memberof OCA.Files
	 */
	Client.prototype = {

		/**
		 * Join path sections
		 *
		 * @param {...String} path sections
		 *
		 * @return {String} path with leading slash and no trailing slash
		 */
		_buildPath: function() {
			var path = '';
			_.each(arguments, function(section) {
				// trim leading slashes
				while (section.charAt(0) === '/') {
					section = section.substr(1);
				}
				// trim trailing slashes
				while (section.charAt(section.length - 1) === '/') {
					section = section.substr(0, section.length - 1);
				}

				// TODO: replace doubled slashes

				path = path + '/' + section;
			});
			return path;
		},

		/**
		 * Convert the WebDAV permissions format to OC format
		 *
		 * @param {String} permissions permissions string
		 * 
		 * @return {int} integer value
		 */
		_parsePermissions: function() {
		},

		/**
		 * Parse Webdav result
		 *
		 * @param {Object} response XML object
		 *
		 * @return {Array.<FileInfo>} array of file info
		 */
		_parseFileInfo: function(response) {
			var path = response.href;
			if (path.substr(0, this._root.length) === this._root) {
				path = path.substr(this._root.length);
			}

			var data = {
				path: path,
				mtime: response.getProperty(Client.NS_DAV, 'getlastmodified').getParsedValue(),
				etag: response.getProperty(Client.NS_DAV, 'getetag').getParsedValue(),
				size: response.getProperty(Client.NS_OWNCLOUD, 'size').getParsedValue(),
				_props: response
			};
			
			var contentType = response.getProperty(Client.NS_DAV, 'getcontenttype');
			if (contentType && contentType.status === 200) {
				data.mime = contentType.getParsedValue();
			}

			var resType = response.getProperty(Client.NS_DAV, 'resourcetype');
			var isFile = true;
			if (!data.mime && resType && resType.status === 200 && resType.xmlvalue) {
				var xmlvalue = resType.xmlvalue[0];
				if (xmlvalue.namespaceURI === Client.NS_DAV && xmlvalue.localName === 'collection') {
					data.mime = 'httpd/unix-directory';
					isFile = false;
				}
			}

			var permissionProp = response.getProperty(Client.NS_OWNCLOUD, 'permissions');
			if (permissionProp && permissionProp.status === 200) {
				var permString = permissionProp.getParsedValue();
				data.permissions = OC.PERMISSION_READ;
				for (var i = 0; i < permString.length; i++) {
					var c = permString.charAt(i);
					switch (c) {
						// FIXME: twisted permissions
						case 'C':
						case 'K':
							data.permissions |= OC.PERMISSION_CREATE;
							break;
						case 'W':
							if (isFile) {
								// also add create permissions
								data.permissions |= OC.PERMISSION_CREATE;
							}
							data.permissions |= OC.PERMISSION_UPDATE;
							break;
						case 'D':
							data.permissions |= OC.PERMISSION_DELETE;
							break;
						case 'R':
							data.permissions |= OC.PERMISSION_SHARE;
							break;
						case 'M':
							data.isMount = true;
							break;
						case 'S':
							data.isShared = true;
							break;
					}
				}
			}

			return new FileInfo(data);
		},

		/**
		 * Parse Webdav multistatus
		 *
		 * @param {Object} response XML object
		 */
		_parseResult: function(response) {
			var self = this;
			var result = [];
			var names = response.getResponseNames();
			_.each(names, function(name) {
				result.push(self._parseFileInfo(response.getResponse(name)));
			});
			console.log(result);
			return result;
		},

		_getPropfindProperties: function() {
			if (!this._propfindProperties) {
				this._propfindProperties = _.map(Client._PROPFIND_PROPERTIES, function(propDef) {
					var prop = new nl.sara.webdav.Property();
					prop.namespace = propDef[0];
					prop.tagname = propDef[1];
					return prop;
				});
			}
			return this._propfindProperties;
		},

		/**
		 * Lists the contents of a directory
		 *
		 * @param {String} path path to retrieve
		 * @param {Array} [properties] list of webdav properties to
		 * retrieve
		 * @param {Function} callback callback that receives an array
		 * of files as parameter
		 *
		 * @return {Promise} promise 
		 */
		list: function(path, properties, callback) {
			if (!path) {
				path = '';
			}
			var self = this;
			var deferred = $.Deferred();
			var promise = deferred.promise();
			if (callback) {
				promise.then(callback);
			}

			var callback = function(status, body, headers) {
				deferred.resolve(self._parseResult(body));
			}
			var result = this.client.propfind(
				this._buildPath(this._root, path),
				callback,
				1,
				this._getPropfindProperties()
			);
			return promise;
		},

		/**
		 * Returns the file info of a given path.
		 *
		 * @param {String} path path 
		 * @param {Array} [properties] list of webdav properties to
		 * retrieve
		 *
		 * @return {OC.Files.FileInfo} file info
		 * @throws FileNotFoundException
		 */
		getFileInfo: function(path, properties) {
		},

		/**
		 * 
		 */
		getFileContents: function(path) {
		}

	};

	if (!OC.Files) {
		OC.Files = {};
	}
	OC.Files.Client = Client;
})();

