// The three marker layers of the map and how their markers look.
// ES module. It uses `L` (Leaflet) and `Utils` from the classic scripts loaded in index.html.

// Resource types. Only salt for now. Add a line here later, e.g.  wood: { label: 'Wood', icon: 'fa-tree' }
// `icon` is a Font Awesome name (placeholder until you have your own icon images).
export const RESOURCE_TYPES = {
    salt: { label: 'Salt', icon: 'fa-cube' }
};

// `shape`: 'pin' = the template's map pin with an icon inside, 'circle' / 'square' = a colored shape.
export const LAYER_DEFS = [
    {
        id: 'resources',
        name: 'Resources',
        label: 'Resource',
        shape: 'pin',
        sidebar_icon: '<i class="fas fa-cube"></i>',
        has_type: true,
        has_color: false
    },
    {
        id: 'decorations',
        name: 'Decorations',
        label: 'Decoration',
        shape: 'circle',
        sidebar_icon: '<i class="fas fa-circle"></i>',
        has_type: false,
        has_color: true,
        default_color: '#e67e22',
        default_name: 'Decoration'
    },
    {
        id: 'events',
        name: 'Events',
        label: 'Event',
        shape: 'square',
        sidebar_icon: '<i class="fas fa-square"></i>',
        has_type: false,
        has_color: true,
        default_color: '#8e44ad',
        default_name: 'Event'
    }
];

// editor.js plugs into marker popups through this (so this file does not need to know about editing).
export const hooks = { popupOpen: null };

export function isValidColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function emptyCollection() {
    return { type: 'FeatureCollection', features: [] };
}

/**
 * Suggest a free name like "Salt 3" or "Event 2".
 */
export function suggestName(def, collection, typeKey) {
    const base = def.has_type ? (RESOURCE_TYPES[typeKey] || RESOURCE_TYPES.salt).label : def.default_name;
    const taken = new Set(collection.features.map(feature => feature.properties && feature.properties.id));
    let number = collection.features.length + 1;

    while (taken.has(`${base} ${number}`)) {
        number++;
    }

    return `${base} ${number}`;
}

/**
 * Build the Leaflet icon for a marker.
 */
export function makeIcon(def, properties) {
    if (def.shape === 'pin') {
        const type = RESOURCE_TYPES[properties.type] || RESOURCE_TYPES.salt;
        return Utils.getCustomIcon(type.icon);
    }

    // The color comes from the database, so only accept a plain #rrggbb value.
    const color = isValidColor(properties.color) ? properties.color : def.default_color;

    return L.divIcon({
        className: 'shape-icon',
        html: `<div class="shape-marker shape-${def.shape}" style="background:${color}"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12],
        tooltipAnchor: [0, -12]
    });
}

/**
 * Add all three layers to the interactive map.
 * @param {InteractiveMap} interactive_map The map
 * @param {Object<string, object>} data Layer id -> GeoJSON FeatureCollection (from the database)
 */
export function addDatabaseLayers(interactive_map, data) {
    LAYER_DEFS.forEach(def => {
        interactive_map.addInteractiveLayer(def.id, data[def.id] || emptyCollection(), {
            name: def.name,
            create_checkbox: true,
            create_feature_popup: true,
            is_default: true,
            sidebar_icon_html: def.sidebar_icon,

            pointToLayer: (feature, latlng) => {
                return L.marker(latlng, {
                    icon: makeIcon(def, feature.properties),
                    riseOnHover: true
                });
            },

            onEachFeature: (feature, layer) => {
                if (feature.properties.name) {
                    // A DOM element instead of a string, so a name can never be read as HTML
                    const tip = document.createElement('span');
                    tip.textContent = feature.properties.name;
                    layer.bindTooltip(tip, {
                        direction: 'top',
                        offset: def.shape === 'pin' ? [0, -36] : [0, 0]
                    });
                }

                layer.on('popupopen', event => {
                    if (hooks.popupOpen) {
                        hooks.popupOpen(def, feature, layer, event.popup);
                    }
                });
            }
        });
    });
}
