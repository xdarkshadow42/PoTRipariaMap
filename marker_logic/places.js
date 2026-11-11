export const PLACES = [
    { name: 'Redwoods', at: '20.25,-139' },
    { name: 'Wind Tunnels', at: '66.5,-127.3125' },
    { name: 'Hollow Hills', at: '75.875,-145.9375' },
    { name: 'Crag Bluffs', at: '92.1875,-121.625' },
    { name: 'Wollemi Forest', at: '128.1875,-143.6875' },
    { name: 'Coastland Swamp', at: '119.84375,-109.15625' },
    { name: 'East Passage', at: '156.5,-112.65625' },
    { name: 'Mudflats', at: '140.40625,-90.28125' },
    { name: 'Black Fern Hills', at: '18.6875,-82' },
    { name: 'Cedrus Forest', at: '51.59375,-69.40625' },
    { name: 'Big Tree Overlook', at: '76.59375,-67' },
    { name: 'Twisted Forest', at: '108.28125,-77.25' },
    { name: 'Stonebed Shoal', at: '151.71875,-79.5' },
    { name: 'Palm Islands', at: '147.25,-53.53125' },
    { name: 'Dry Fang Canyon', at: '23.1875,-23.9375' },
    { name: 'Tallbrush Coasts', at: '73.40625,-37.75' },
    { name: 'Volcano Islands', at: '96.40625,-36.5625' },
    { name: 'Kelp Vale', at: '117.15625,-6.78125' },
    { name: 'Coastal Bluffs', at: '129.25,-29.5' },
    { name: 'Abyssal Depths', at: '151.375,-30.5625' }


];
export function showLayerOnce(subdir, layername) {
    try {
        const listKey = `${subdir}:user:_layers`;
        const seenKey = `${subdir}:seen_layer:${layername}`;

        if (localstorage.getItem(seenKey) ){
            return;
        }

        localStorage.setItem(seenKey, '1');

        const saved = JSON.parse(localStorage.getItem(listKey));

        if (array.isArray(saved) && !saved.includes(layername)) {
            saved.push(layername);
            localStorage.setItem(listKey, JSON.stringify(saved));

        }
    } catch (error) {

    }
}

export function addPlaces(interactive_map) {
    const features = [];

    PLACES.forEach(place => {
        const [lng, lat] = String(place.at).split(',').map(part => parseFloat(part));

        if (!place.name || !Number.isFinite(lng) || !Number.isFinite(lat)) {
            console.warn('Skipping a place with a missing name or a bad position:', place);
            return;
        }

        features.push({
            type: 'Feature',
            properties: { id: place.name, name: place.name },
            geometry: { type: 'Point', coordinates: [lng, lat] }
        });
    });

    interactive_map.addInteractiveLayer('places', { type: 'FeatureCollection', features }, {
        name: 'Places',
        is_default: true,
        feature_group: L.featureGroup(),

        pointToLayer: (feature, latlng) => {
            const text = document.createElement('span');
            text.textContent = feature.properties.name;

            return L.marker(latlng, {
                icon: L.divIcon({
                    className: 'place-label',
                    html: text,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0]
                }),
                // Clicks go straight through the text to the map and markers underneath
                interactive: false,
                keyboard: false,
                // Draw the text below the markers
                zIndexOffset: -1000
            });
        }
    });
}