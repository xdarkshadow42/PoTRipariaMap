// Firebase glue: sign-in and reading/writing the marker layers.
// This file is loaded as an ES module (see index.html), straight from Google's CDN, so no build step is needed.
//
// Database layout (Realtime Database):
//   layers/resources    -> JSON text of a GeoJSON FeatureCollection
//   layers/decorations  -> JSON text of a GeoJSON FeatureCollection
//   layers/events       -> JSON text of a GeoJSON FeatureCollection
//   editors/<user id>   -> true   (only these users may write to layers/*, see the database rules)

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import { getDatabase, ref, get, set } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';

// This config is public by design. The database rules are what protect your data.
const firebaseConfig = {
    apiKey: 'AIzaSyCvHC1FyFgE0ZL-nwPvvjPZBOIxSK28seA',
    authDomain: 'ptsr-interactive-riparia.firebaseapp.com',
    databaseURL: 'https://ptsr-interactive-riparia-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'ptsr-interactive-riparia',
    storageBucket: 'ptsr-interactive-riparia.firebasestorage.app',
    messagingSenderId: '957742382151',
    appId: '1:957742382151:web:26860c986eb684e5604562'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

function emptyCollection() {
    return { type: 'FeatureCollection', features: [] };
}

// Turns the stored text into a FeatureCollection. Throws if the text is damaged,
// so a save can never silently overwrite data it could not read.
function parseCollection(text) {
    if (text === null || text === undefined || text === '') {
        return emptyCollection();
    }

    const collection = JSON.parse(text);

    if (!collection || !Array.isArray(collection.features)) {
        throw new Error('Stored layer data has an unexpected format.');
    }

    return collection;
}

/**
 * Load every layer. Anyone can do this, no sign-in needed.
 * @returns {Promise<Object<string, object>>} Layer id -> GeoJSON FeatureCollection
 */
export async function loadLayers() {
    const snapshot = await get(ref(db, 'layers'));
    const raw = snapshot.val() || {};
    const layers = {};

    for (const [id, text] of Object.entries(raw)) {
        try {
            layers[id] = parseCollection(text);
        } catch (error) {
            console.error(`Could not read layer "${id}":`, error);
            layers[id] = emptyCollection();
        }
    }

    return layers;
}

/**
 * Change one layer. The layer is read fresh from the database, `mutate` changes it, and it is written back.
 * Reading right before writing keeps edits from two editors from overwriting each other (unless they save in the same split second).
 * @param {string} layerId Layer id, e.g. 'decorations'
 * @param {function(object): void} mutate Gets the FeatureCollection and changes it in place. Throw an Error to cancel.
 */
export async function updateLayer(layerId, mutate) {
    const layerRef = ref(db, `layers/${layerId}`);
    const snapshot = await get(layerRef);
    const collection = parseCollection(snapshot.val());

    mutate(collection);

    await set(layerRef, JSON.stringify(collection));
}

/**
 * Get told whenever the sign-in state changes (also once at page load).
 * The callback gets `{ user, isEditor }`. `isEditor` is true only if the user's id is listed under `editors/` in the database.
 * @param {function({user: object|null, isEditor: boolean}): void} callback
 */
export function watchEditor(callback) {
    onAuthStateChanged(auth, async user => {
        if (!user) {
            callback({ user: null, isEditor: false });
            return;
        }

        let isEditor = false;

        try {
            const snapshot = await get(ref(db, `editors/${user.uid}`));
            isEditor = snapshot.val() === true;
        } catch (error) {
            console.error('Could not check editor status:', error);
        }

        callback({ user, isEditor });
    });
}

export function signIn(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

export function signOutUser() {
    return signOut(auth);
}
