// ES module: runs after all the classic scripts in index.html have loaded.

import { loadLayers } from './firebase.js';
import { addDatabaseLayers } from './marker_logic/layers.js';
import { setupEditor, restoreSavedView, showNotice } from './editor.js';
import { addPlaces, showLayerOnce } from './marker_logic/places.js';

showLayerOnce('PoTRipariaMap', 'Places');
// Step 1: Create the map
const interactive_map = new InteractiveMap('map', {
    // Limits automatic zooming (e.g. "locate" buttons) to this zoom level
    max_good_zoom: 4,
    // The highest zoom the map allows. Your image is only sharp up to zoom 3 (the tiles), 4 and 5 are enlarged
    max_map_zoom: 5,
    website_source: 'https://github.com/xdarkshadow42/PoTRipariaMap',
    // Must be exactly the name of your GitHub repository
    website_subdir: 'PoTRipariaMap',
    // Credits shown in the info panel. Add one <li> per credit, for example:
    // <li>Map image by <a href="https://example.com">Somebody</a></li>
    attribution: ''
});

// Step 2: Add your map image (the tiles made with gdal2tiles, zoom 0-3)
interactive_map.addTileLayer('Riparia map', {
    minNativeZoom: 0,
    maxNativeZoom: 3
});

// Step 3: Load the markers from Firebase and add the three layers
let data = {};

try {
    data = await loadLayers();
} catch (error) {
    console.error('Could not load the markers:', error);
    showNotice('Could not load the markers from the database. Check your connection and reload the page.');
}

addDatabaseLayers(interactive_map, data);
addPlaces(interactive_map);
// Step 4: Finish the map after all layers were added
interactive_map.finalize();

// After saving a marker the page reloads; this puts the view back where the editor was
restoreSavedView(interactive_map);

// Step 5: Sign-in and editing tools
setupEditor(interactive_map, data);
