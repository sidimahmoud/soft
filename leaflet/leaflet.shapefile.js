
L.drawLocal.shapefile = {
    toolbar: {
        buttons: {
            upload: 'Upload a shapefile',
            download: 'Download layer as shapefile',
            downloadDisabled: 'No layers to download'
        }
    }
};

L.ShapefileHTTP = {
    Get: function(url, callback) {
        var xhr = new XMLHttpRequest();

        xhr.open('GET', url);
        xhr.onload = function () { return callback(JSON.parse(this.responseText)) };
        xhr.send();
    },
    Post: function(url, formData, callback) {
        var xhr = new XMLHttpRequest();

        xhr.open('POST', url, true);
        xhr.onload = function () { return callback(JSON.parse(this.responseText)) };
        xhr.send(formData);
    }
};

L.ShapefileToolbar = L.Toolbar.extend({
    statics: {
        TYPE: 'shapefile'
    },

    options: {
        upload: true,
        download: true,
        featureGroup: null /* REQUIRED! TODO: perhaps if not set then all layers on the map are selectable? */
    },

    initialize: function (options) {
        options = L.extend({}, this.options, options);

        this._toolbarClass = 'leaflet-draw-shapefile';

        L.Toolbar.prototype.initialize.call(this, options);
    },

    getModeHandlers: function (map) {
        var featureGroup = this.options.featureGroup,
            uploadHandler = new L.ShapefileToolbar.Upload(map, {
                featureGroup: featureGroup
            }),
            downloadHandler = new L.ShapefileToolbar.Download(map, {
                featureGroup: featureGroup
            });

        uploadHandler.on('enabled', this.upload, this);
        downloadHandler.on('enabled', this.download, this);

        return [
            {
                enabled: this.options.upload,
                handler: uploadHandler,
                title: L.drawLocal.shapefile.toolbar.buttons.upload
            },
            {
                enabled: this.options.download,
                handler: downloadHandler,
                title: L.drawLocal.shapefile.toolbar.buttons.download
            }
        ];
    },

    getActions: function () {
        return [];
    },

    addToolbar: function (map) {
        var container = L.Toolbar.prototype.addToolbar.call(this, map);

        this._checkDisabled();

        this.options.featureGroup.on('layeradd layerremove', this._checkDisabled, this);

        return container;
    },

    removeToolbar: function () {
        this.options.featureGroup.off('layeradd layerremove', this._checkDisabled, this);

        L.Toolbar.prototype.removeToolbar.call(this);
    },

    disable: function () {
        if (!this.enabled()) { return; }

        L.Toolbar.prototype.disable.call(this);
    },

    upload: function () {
        var formData = new FormData(),
            featureGroup = this.options.featureGroup,
            button = this._modes[L.ShapefileToolbar.Upload.TYPE].button,
            input = document.createElement('input');

        input.onchange = function() {
            L.DomUtil.addClass(button, 'leaflet-draw-shapefile-loading');

            formData.append('shapefile', input.files[0]);

            L.ShapefileHTTP.Post('http://shapefile.io/v1/upload', formData, function(data) {
                L.ShapefileHTTP.Get('http://shapefile.io' + data.features + '?epsg=4326', function(geojson) {
                    for (var i = 0; i < geojson.features.length; i++) {
                        L.geoJson(geojson.features[i]).addTo(featureGroup);
                    }

                    L.DomUtil.removeClass(button, 'leaflet-draw-shapefile-loading');
                });
            });
        };
        input.type = 'file';
        input.click();
    },

    download: function () {
        var formData = new FormData(),
            geojson = this.options.featureGroup.toGeoJSON();

        formData.append('geojson', JSON.stringify(geojson));

        L.ShapefileHTTP.Post('http://shapefile.io/v1/new', formData, function(data) {
            window.location.href = 'http://shapefile.io' + data.download;
        });
    },

    _checkDisabled: function() {
        var featureGroup = this.options.featureGroup,
            hasLayers = featureGroup.getLayers().length !== 0,
            button;

        if (this.options.download) {
            button = this._modes[L.ShapefileToolbar.Download.TYPE].button;

            if (hasLayers) {
                L.DomUtil.removeClass(button, 'leaflet-disabled');
            } else {
                L.DomUtil.addClass(button, 'leaflet-disabled');
            }

            button.setAttribute(
                'title',
                hasLayers ?
                L.drawLocal.shapefile.toolbar.buttons.download
                : L.drawLocal.shapefile.toolbar.buttons.downloadDisabled
            );
        }
    }
});


L.ShapefileToolbar.Upload = L.Handler.extend({
    statics: {
        TYPE: 'upload'
    },

    includes: L.Mixin.Events,

    initialize: function (map, options) {
        L.Handler.prototype.initialize.call(this, map);

        L.setOptions(this, options);

        // Store the selectable layer group for ease of access
        this._featureGroup = options.featureGroup;

        if (!(this._featureGroup instanceof L.FeatureGroup)) {
            throw new Error('options.featureGroup must be a L.FeatureGroup');
        }

        // Save the type so super can fire, need to do this as cannot do this.TYPE :(
        this.type = L.ShapefileToolbar.Upload.TYPE;
    },

    enable: function () {
        if (this._enabled) {
            return;
        }
        this.fire('enabled', {handler: this.type});
            //this disable other handlers

        this._map.fire('shapefile:uploadstart', { handler: this.type });
            //allow drawLayer to be updated before beginning edition.

        L.Handler.prototype.enable.call(this);
    },

    disable: function () {
        if (!this._enabled) {
            return;
        }

        L.Handler.prototype.disable.call(this);

        this._map.fire('draw:uploadfinish', { handler: this.type });

        this.fire('disabled', {handler: this.type});
    },

    addHooks: function () {},

    removeHooks: function () {}
});

L.ShapefileToolbar.Download = L.Handler.extend({
    statics: {
        TYPE: 'download'
    },

    includes: L.Mixin.Events,

    initialize: function (map, options) {
        L.Handler.prototype.initialize.call(this, map);

        L.Util.setOptions(this, options);

        // Store the selectable layer group for ease of access
        this._deletableLayers = this.options.featureGroup;

        if (!(this._deletableLayers instanceof L.FeatureGroup)) {
            throw new Error('options.featureGroup must be a L.FeatureGroup');
        }

        // Save the type so super can fire, need to do this as cannot do this.TYPE :(
        this.type = L.ShapefileToolbar.Download.TYPE;
    },

    enable: function () {
        if (this._enabled || !this._hasAvailableLayers()) {
            return;
        }
        this.fire('enabled', { handler: this.type});

        this._map.fire('draw:downloadstart', { handler: this.type });

        L.Handler.prototype.enable.call(this);
    },

    disable: function () {
        if (!this._enabled) {
            return;
        }

        L.Handler.prototype.disable.call(this);

        this._map.fire('draw:downloadfinish', { handler: this.type });

        this.fire('disabled', { handler: this.type});
    },

    addHooks: function () {},

    removeHooks: function () {},

    _hasAvailableLayers: function () {
        return this._deletableLayers.getLayers().length !== 0;
    }
});
