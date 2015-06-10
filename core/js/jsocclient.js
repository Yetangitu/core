/*
 * Copyright (c) 2015
 *
 * This file is licensed under the Affero General Public License version 3
 * or later.
 *
 * See the COPYING-README file.
 *
 */

/* global nl */

(function() {

	var FileInfo = function(data) {
		var path = data.path;
		this.path = OC.dirname(path);
		this.name = OC.basename(path);
		this.mtime = data.mtime;
		this.etag = data.etag;
		this.permissions = data.permissions;
		this.size = data.size;
		this.mimetype = data.mimetype;
		this._props = data._props;

		// TODO: isSharedMount and other props

		if (this.mimetype === 'httpd/unix-directory') {
			this.type = 'dir';
		} else {
			this.type = 'file';
			this.isPreviewAvailable = true;
		}
	};

	FileInfo.prototype = {
		/**
		 * File id
		 *
		 * @type int
		 */
		id: null,

		/**
		 * File name
		 *
		 * @type String
		 */
		name: null,

		/**
		 * Path leading to the file, without the file name.
		 *
		 * @type String
		 */
		path: null,

		/**
		 * Mime type
		 *
		 * @type String
		 */
		mimetype: null,

		/**
		 * File type. 'file'  for files, 'dir' for directories.
		 *
		 * @type String
		 * @deprecated rely on mimetype instead
		 */
		type: 'file',

		/**
		 * Permissions.
		 *
		 * @see OC#PERMISSION_ALL for permissions
		 * @type int
		 */
		permissions: null,

		/**
		 * Modification time
		 *
		 * @type int
		 */
		mtime: null,

		/**
		 * Etag
		 *
		 * @type String
		 */
		etag: null,

		/**
		 * Whether the file is a share mount point
		 *
		 * @type boolean
		 */
		isShareMountPoint: false,

		/**
		 * Whether previews are supported for this file's mime type
		 *
		 * @type boolean
		 * @deprecated infer from mime type
		 */
		isPreviewAvailable: false,

		/**
		 * URL path to the mime type icon
		 *
		 * @deprecated infer from the mime type
		 */
		icon: null
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

		if (!options.port) {
			// workaround in case port is null or empty
			options.port = undefined;
		}
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
			var lastArg = arguments[arguments.length - 1];
			var trailingSlash = lastArg.charAt(lastArg.length - 1) === '/';
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
			if (trailingSlash) {
				// add it back
				path += '/';
			}
			return path;
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

			if (path.charAt(path.length - 1) === '/') {
				path = path.substr(0, path.length - 1);
			}

			var data = {
				path: decodeURIComponent(path),
				mtime: response.getProperty(Client.NS_DAV, 'getlastmodified').getParsedValue(),
				etag: response.getProperty(Client.NS_DAV, 'getetag').getParsedValue(),
				size: response.getProperty(Client.NS_OWNCLOUD, 'size').getParsedValue(),
				_props: response
			};
			
			var contentType = response.getProperty(Client.NS_DAV, 'getcontenttype');
			if (contentType && contentType.status === 200) {
				data.mimetype = contentType.getParsedValue();
			}

			var resType = response.getProperty(Client.NS_DAV, 'resourcetype');
			var isFile = true;
			if (!data.mimetype && resType && resType.status === 200 && resType.xmlvalue) {
				var xmlvalue = resType.xmlvalue[0];
				if (xmlvalue.namespaceURI === Client.NS_DAV && xmlvalue.localName === 'collection') {
					data.mimetype = 'httpd/unix-directory';
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
		 * @param {Function} callback callback that receives an array
		 * of files as parameter
		 * @param {boolean} [includeParent=false] set to true to keep
		 * the parent folder in the result list
		 *
		 * @return {Promise} promise 
		 */
		list: function(path, callback, includeParent) {
			if (!path) {
				path = '';
			}
			var self = this;
			var deferred = $.Deferred();
			var promise = deferred.promise();
			if (callback) {
				promise.then(callback);
			}

			this.client.propfind(
				this._buildPath(this._root, path),
				function(status, body) {
					// TODO: handle error cases like 404
					var results = self._parseResult(body);
					if (!includeParent) {
						// remove root dir, the first entry
						results.shift();
					}
					deferred.resolve(results);
				},
				1,
				this._getPropfindProperties()
			);
			return promise;
		},

		/**
		 * Returns the file info of a given path.
		 *
		 * @param {String} path path 
		 * @param {Function} callback callback that receives
		 * @param {Array} [properties] list of webdav properties to
		 * retrieve
		 *
		 * @return {Promise} promise
		 */
		getFileInfo: function(path, callback) {
			if (!path) {
				path = '';
			}
			var self = this;
			var deferred = $.Deferred();
			var promise = deferred.promise();
			if (callback) {
				promise.then(callback);
			}

			this.client.propfind(
				this._buildPath(this._root, path),
				function(status, body) {
					// TODO: handle error cases like 404
					deferred.resolve(self._parseResult(body)[0]);
				},
				0,
				this._getPropfindProperties()
			);
			return promise;
		},

		/**
		 * Returns the contents of the given file.
		 *
		 * @param {String} path path to file
		 * @param {Function} callback callback that receives the file content
		 *
		 * @return {Promise}
		 */
		getFileContents: function(path, callback) {
			if (!path) {
				throw 'Missing argument "path"';
			}
			var self = this;
			var deferred = $.Deferred();
			var promise = deferred.promise();
			if (callback) {
				promise.then(callback);
			}

			this.client.get(
				this._buildPath(this._root, path),
				function(status, body) {
					// TODO: handle error cases like 404
					deferred.resolve(self._parseResult(body)[0]);
				}
			);
			return promise;
		},

		/**
		 * Puts the given data into the given file.
		 *
		 * @param {String} path path to file
		 * @param {Function} callback callback that receives the file content
		 *
		 * @return {Promise}
		 */
		putFileContents: function(path, callback, body) {
			if (!path) {
				throw 'Missing argument "path"';
			}
			var deferred = $.Deferred();
			var promise = deferred.promise();
			if (callback) {
				promise.then(callback);
			}

			this.client.put(
				this._buildPath(this._root, path),
				function(status, body) {
					// TODO: handle error cases like 404
					deferred.resolve();
				},
				body || ''
			);
			return promise;
		},
		
		_simpleCall: function(method, path, callback) {
			if (!path) {
				throw 'Missing argument "path"';
			}

			var deferred = $.Deferred();
			var promise = deferred.promise();
			if (callback) {
				promise.then(callback);
			}

			this.client[method](
				this._buildPath(this._root, path),
				function(status, body) {
					// TODO: handle error cases like 404
					deferred.resolve();
				}
			);
		},

		/**
		 * Creates a directory
		 *
		 * @param {String} path path to create
		 * @param {Function} callback callback that receives the file content
		 *
		 * @return {Promise}
		 */
		createDirectory: function(path, callback) {
			return this._simpleCall('mkcol', path, callback);
		},

		/**
		 * Deletes a file or directory
		 *
		 * @param {String} path path to delete
		 * @param {Function} callback callback that receives the file content
		 *
		 * @return {Promise}
		 */
		remove: function(path, callback) {
			return this._simpleCall('remove', path, callback);
		},

		/**
		 * Moves path to another path
		 *
		 * @param {String} path path to move
		 * @param {String} destinationPath destination path
		 * @param {Function} callback callback that receives an array
		 * of files as parameter
		 * @param {boolean} [allowOverwrite=false] true to allow overwriting,
		 * false otherwise
		 *
		 * @return {Promise} promise 
		 */
		move: function(path, destinationPath, callback, allowOverwrite) {
			if (!path) {
				throw 'Missing argument "path"';
			}
			if (!destinationPath) {
				throw 'Missing argument "destinationPath"';
			}
			var deferred = $.Deferred();
			var promise = deferred.promise();
			if (callback) {
				promise.then(callback);
			}

			this.client.move(
				this._buildPath(this._root, path),
				function(status) {
					deferred.resolve(status);
				},
				this._buildPath(this._root, destinationPath),
				allowOverwrite ? nl.sara.webdav.Client.SILENT_OVERWRITE : nl.sara.webdav.Client.FAIL_ON_OVERWRITE
			);
			return promise;
		},

	};

	if (!OC.Files) {
		OC.Files = {};
	}
	OC.Files.Client = Client;

	OC.Files.FileInfo = FileInfo;
})();

