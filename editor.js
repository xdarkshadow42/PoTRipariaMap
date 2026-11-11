// Editor tools: sign-in, and adding / editing / deleting markers.
// Only people listed under `editors/` in the database can save. Everyone else just sees the map.

import { watchEditor, signIn, signOutUser, updateLayer } from './firebase.js';
import {
    LAYER_DEFS,
    RESOURCE_TYPES,
    hooks,
    isValidColor,
    suggestName,
    emptyCollection
} from './marker_logic/layers.js';

// The page address as it was when the page loaded. The template rewrites the address bar while you click around,
// so after saving we go back to this clean address instead of reloading the rewritten one.
const BASE_PATH = window.location.pathname;

// These characters would break share links (?list=...&id=...)
const FORBIDDEN_NAME_CHARS = /[&#?%+]/;

const viewKey = subdir => `${subdir}:saved_view`;

/**
 * Small helper to build HTML elements safely (text is never read as HTML).
 */
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);

    Object.entries(props).forEach(([key, value]) => {
        if (key === 'class') {
            node.className = value;
        } else if (key === 'text') {
            node.textContent = value;
        } else if (key.startsWith('on')) {
            node.addEventListener(key.slice(2), value);
        } else {
            node.setAttribute(key, value);
        }
    });

    children.flat().filter(Boolean).forEach(child => node.append(child));

    return node;
}

function field(label, input) {
    return el('label', { class: 'editor-field' }, el('span', { text: label }), input);
}

function newUid() {
    if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }

    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function round(number) {
    return Math.round(number * 10000) / 10000;
}

function friendlyAuthError(error) {
    switch (error && error.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
        case 'auth/invalid-email':
            return 'Wrong email or password.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Wait a few minutes and try again.';
        case 'auth/network-request-failed':
            return 'Network problem. Check your connection.';
        default:
            return 'Sign-in failed: ' + ((error && error.message) || error);
    }
}

function describeError(error) {
    const text = (error && error.message) || String(error);

    if ((error && error.code === 'PERMISSION_DENIED') || /permission_denied/i.test(text)) {
        return 'Saving was refused. This account is not allowed to edit (check the editors list in Firebase).';
    }

    return text;
}

function assertNameFree(collection, name, ownUid) {
    const clash = collection.features.some(feature => {
        return feature.properties && feature.properties.id === name && feature.properties.uid !== ownUid;
    });

    if (clash) {
        throw new Error(`There is already a marker named "${name}" in this layer.`);
    }
}

function makeProperties(def, uid, values) {
    const properties = { uid, id: values.name, name: values.name };

    if (values.description) {
        properties.description = values.description;
    }

    if (def.has_color) {
        properties.color = isValidColor(values.color) ? values.color : def.default_color;
    }

    if (def.has_type) {
        properties.type = values.type in RESOURCE_TYPES ? values.type : 'salt';
    }

    return properties;
}

/**
 * Show a small dismissable message at the top of the page.
 * @param {string} text Message
 */
export function showNotice(text) {
    const notice = el('div', { class: 'editor-notice', text, title: 'Click to dismiss' });
    notice.addEventListener('click', () => notice.remove());
    document.body.append(notice);
}

/**
 * After a save the page reloads. This puts the map back to where the editor was looking.
 * Call it right after `interactive_map.finalize()`.
 * @param {InteractiveMap} interactive_map The map
 */
export function restoreSavedView(interactive_map) {
    const key = viewKey(interactive_map.getWebsiteSubdir());

    try {
        const text = sessionStorage.getItem(key);

        if (!text) {
            return;
        }

        sessionStorage.removeItem(key);
        const view = JSON.parse(text);

        if (Number.isFinite(view.lat) && Number.isFinite(view.lng) && Number.isFinite(view.zoom)) {
            interactive_map.getMap().setView([view.lat, view.lng], view.zoom, { animate: false });
        }
    } catch (error) {
        // Not important, the map just opens at the default view
    }
}

/**
 * Set up sign-in and editing.
 * @param {InteractiveMap} interactive_map The map
 * @param {Object<string, object>} layerData Layer id -> GeoJSON FeatureCollection as loaded from the database
 */
export function setupEditor(interactive_map, layerData) {
    const map = interactive_map.getMap();
    const sidebar = interactive_map.getSidebar();
    const share = interactive_map.getShareMarker();
    const subdir = interactive_map.getWebsiteSubdir();

    let session = { user: null, isEditor: false };
    let adding = false;
    let dialog = null;

    // The template's own "add or edit marker" button only edits private markers in this browser.
    // Shared markers are edited through the editor bar below, so hide that button to avoid confusion.
    sidebar.removePanel('edit');

    // ---------- Reload after saving ----------

    function reloadKeepingView() {
        try {
            const center = map.getCenter();
            sessionStorage.setItem(viewKey(subdir), JSON.stringify({
                lat: center.lat,
                lng: center.lng,
                zoom: map.getZoom()
            }));
        } catch (error) {
            // Not important
        }

        window.location.assign(BASE_PATH);
    }

    async function commit(def, mutate) {
        await updateLayer(def.id, mutate);
        reloadKeepingView();
    }

    // ---------- Forms ----------

    function buildForm(def, values, submitLabel, onSubmit, onCancel) {
        const message = el('p', { class: 'editor-message' });

        const nameInput = el('input', { type: 'text', maxlength: '40', required: '', value: values.name });
        const fields = [field('Name', nameInput)];

        let typeSelect = null;
        if (def.has_type) {
            typeSelect = el('select');
            Object.entries(RESOURCE_TYPES).forEach(([key, type]) => {
                const option = el('option', { value: key, text: type.label });
                option.selected = key === values.type;
                typeSelect.append(option);
            });
            fields.push(field('Type', typeSelect));
        }

        let colorInput = null;
        if (def.has_color) {
            colorInput = el('input', { type: 'color', value: values.color });
            fields.push(field('Color', colorInput));
        }

        const descriptionInput = el('textarea', { rows: '3', maxlength: '300' });
        descriptionInput.value = values.description || '';
        fields.push(field('Description (optional)', descriptionInput));

        const saveButton = el('button', { type: 'submit', class: 'editor-button primary', text: submitLabel });
        const cancelButton = el('button', { type: 'button', class: 'editor-button', text: 'Cancel', onclick: onCancel });

        return el('form', {
            class: 'editor-form',
            onsubmit: async event => {
                event.preventDefault();
                message.textContent = '';

                const name = nameInput.value.trim();

                if (!name) {
                    message.textContent = 'Please enter a name.';
                    return;
                }

                if (FORBIDDEN_NAME_CHARS.test(name)) {
                    message.textContent = 'The name cannot contain & # ? % or +';
                    return;
                }

                saveButton.disabled = true;
                cancelButton.disabled = true;
                saveButton.textContent = 'Saving...';

                try {
                    await onSubmit({
                        name,
                        description: descriptionInput.value.trim(),
                        color: colorInput ? colorInput.value : undefined,
                        type: typeSelect ? typeSelect.value : undefined
                    });
                } catch (error) {
                    console.error(error);
                    message.textContent = describeError(error);
                    saveButton.disabled = false;
                    cancelButton.disabled = false;
                    saveButton.textContent = submitLabel;
                }
            }
        }, fields, message, el('div', { class: 'editor-actions' }, saveButton, cancelButton));
    }

    function openFormPopup(latlng, offset, title, form) {
        const content = el('div', { class: 'editor-popup' }, el('h3', { text: title }), form);

        L.popup({ closeOnClick: false, offset, minWidth: 240, maxWidth: 300 })
            .setLatLng(latlng)
            .setContent(content)
            .openOn(map);
    }

    // ---------- Add ----------

    function openAddForm(def, latlng) {
        const collection = layerData[def.id] || emptyCollection();
        const values = {
            name: suggestName(def, collection, 'salt'),
            description: '',
            color: def.default_color,
            type: 'salt'
        };

        const form = buildForm(def, values, 'Add marker', async submitted => {
            const feature = {
                type: 'Feature',
                properties: makeProperties(def, newUid(), submitted),
                geometry: { type: 'Point', coordinates: [round(latlng.lng), round(latlng.lat)] }
            };

            await commit(def, fresh => {
                assertNameFree(fresh, submitted.name, null);
                fresh.features.push(feature);
            });
        }, () => map.closePopup());

        openFormPopup(latlng, L.point(0, -8), `New ${def.label.toLowerCase()}`, form);
    }

    function onMapClick(event) {
        // The template's share marker also reacts to map clicks. Remove what it just placed.
        share.removeMarker();
        Utils.setHistoryState(undefined, undefined, subdir);

        const def = LAYER_DEFS.find(candidate => candidate.id === layerSelect.value);
        openAddForm(def, event.latlng);
    }

    function setAdding(on) {
        if (on === adding) {
            return;
        }

        adding = on;
        addButton.textContent = on ? 'Cancel (click the map to place)' : 'Add marker';
        addButton.classList.toggle('active', on);
        map.getContainer().classList.toggle('adding-marker', on);

        if (on) {
            share.turnOff();
            map.on('click', onMapClick);
        } else {
            map.off('click', onMapClick);
            share.turnOn();
        }
    }

    // ---------- Edit and delete (buttons inside a marker's popup) ----------

    function openEditForm(def, feature, layer) {
        const properties = feature.properties;

        if (!properties.uid) {
            window.alert('This marker has no internal id, so it cannot be edited here.');
            return;
        }

        const values = {
            name: properties.name || properties.id,
            description: properties.description || '',
            color: isValidColor(properties.color) ? properties.color : def.default_color,
            type: properties.type || 'salt'
        };

        const anchor = layer.options.icon.options.popupAnchor || [0, 0];
        const latlng = layer.getLatLng();
        layer.closePopup();

        const form = buildForm(def, values, 'Save', async submitted => {
            await commit(def, fresh => {
                const target = fresh.features.find(candidate => {
                    return candidate.properties && candidate.properties.uid === properties.uid;
                });

                if (!target) {
                    throw new Error('This marker no longer exists. Someone else may have deleted it.');
                }

                assertNameFree(fresh, submitted.name, properties.uid);

                const next = { ...target.properties, ...makeProperties(def, properties.uid, submitted) };

                if (!submitted.description) {
                    delete next.description;
                }

                target.properties = next;
            });
        }, () => map.closePopup());

        openFormPopup(latlng, L.point(anchor[0], anchor[1]), `Edit ${def.label.toLowerCase()}`, form);
    }

    async function deleteFeature(def, feature) {
        const properties = feature.properties;

        if (!properties.uid) {
            window.alert('This marker has no internal id, so it cannot be deleted here.');
            return;
        }

        if (!window.confirm(`Delete "${properties.name || properties.id}"?`)) {
            return;
        }

        try {
            await commit(def, fresh => {
                fresh.features = fresh.features.filter(candidate => {
                    return !(candidate.properties && candidate.properties.uid === properties.uid);
                });
            });
        } catch (error) {
            console.error(error);
            window.alert(describeError(error));
        }
    }

    hooks.popupOpen = (def, feature, layer, popup) => {
        if (!session.isEditor) {
            return;
        }

        const container = popup.getElement();
        const root = container && container.querySelector('.popup-id');

        if (!root) {
            return;
        }

        root.append(el('div', { class: 'editor-actions editor-popup-actions' },
            el('button', {
                type: 'button',
                class: 'editor-button',
                text: 'Edit',
                onclick: () => openEditForm(def, feature, layer)
            }),
            el('button', {
                type: 'button',
                class: 'editor-button danger',
                text: 'Delete',
                onclick: () => deleteFeature(def, feature)
            })
        ));
    };

    // ---------- Sign-in dialog ----------

    function closeDialog() {
        if (dialog) {
            dialog.remove();
            dialog = null;
        }
    }

    function openDialog(title, ...content) {
        closeDialog();

        dialog = el('div', {
            class: 'editor-overlay',
            onclick: event => {
                if (event.target === dialog) {
                    closeDialog();
                }
            }
        }, el('div', { class: 'editor-dialog' }, el('h2', { text: title }), content));

        document.body.append(dialog);
    }

    function openLoginDialog() {
        const message = el('p', { class: 'editor-message' });
        const email = el('input', { type: 'email', required: '', autocomplete: 'username' });
        const password = el('input', { type: 'password', required: '', autocomplete: 'current-password' });
        const submit = el('button', { type: 'submit', class: 'editor-button primary', text: 'Sign in' });

        const form = el('form', {
            class: 'editor-form',
            onsubmit: async event => {
                event.preventDefault();
                message.textContent = '';
                submit.disabled = true;

                try {
                    await signIn(email.value.trim(), password.value);
                    closeDialog();
                } catch (error) {
                    console.error(error);
                    message.textContent = friendlyAuthError(error);
                    submit.disabled = false;
                }
            }
        },
            field('Email', email),
            field('Password', password),
            message,
            el('div', { class: 'editor-actions' },
                submit,
                el('button', { type: 'button', class: 'editor-button', text: 'Close', onclick: closeDialog })
            )
        );

        openDialog('Editor sign-in', form);
        email.focus();
    }

    function openNotEditorDialog(user) {
        openDialog(
            'Not an editor',
            el('p', { text: `${user.email || 'This account'} is signed in, but is not on the editors list, so it cannot change the map.` }),
            el('div', { class: 'editor-actions' },
                el('button', {
                    type: 'button',
                    class: 'editor-button primary',
                    text: 'Sign out',
                    onclick: async () => {
                        await signOutUser();
                        closeDialog();
                    }
                }),
                el('button', { type: 'button', class: 'editor-button', text: 'Close', onclick: closeDialog })
            )
        );
    }

    // ---------- Editor bar (only visible for editors) ----------

    const userLabel = el('span', { class: 'editor-user' });
    const layerSelect = el('select', { 'aria-label': 'Layer to add to' });
    LAYER_DEFS.forEach(def => layerSelect.append(el('option', { value: def.id, text: def.label })));

    const addButton = el('button', {
        type: 'button',
        class: 'editor-button primary',
        text: 'Add marker',
        onclick: () => setAdding(!adding)
    });

    const signOutButton = el('button', {
        type: 'button',
        class: 'editor-button',
        text: 'Sign out',
        onclick: () => signOutUser()
    });

    const bar = el('div', { class: 'editor-bar', hidden: '' }, userLabel, layerSelect, addButton, signOutButton);
    document.body.append(bar);

    // ---------- Sidebar button ----------

    sidebar.addPanel({
        id: 'editor-login',
        tab: '<i class="fas fa-user-lock"></i>',
        title: 'Editor sign-in',
        position: 'bottom',
        button: () => {
            if (session.isEditor) {
                bar.hidden = !bar.hidden;
            } else if (session.user) {
                openNotEditorDialog(session.user);
            } else {
                openLoginDialog();
            }
        }
    });

    // ---------- React to sign-in / sign-out ----------

    watchEditor(state => {
        session = state;

        if (state.isEditor) {
            userLabel.textContent = state.user.email || 'Editor';
            bar.hidden = false;
        } else {
            bar.hidden = true;
            setAdding(false);

            if (state.user) {
                openNotEditorDialog(state.user);
            }
        }
    });
}
