const { app, constants, action } = require("photoshop");
const { 
    findLayer, 
    execute, 
    parseColor, 
    selectLayer 
} = require("./utils");

const {hasActiveSelection} = require("./utils")

const clearSelection = async () => {
    await execute(async () => {
        await action.batchPlay([{
            _obj: "set",
            _target: [{ _ref: "channel", _property: "selection" }],
            to: { _enum: "ordinal", _value: "none" }
        }], {});
    });
};

const createMaskFromSelection = async (command) => {

    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `createMaskFromSelection : Could not find layerId : ${layerId}`
        );
    }

    await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            {
                _obj: "make",
                at: {
                    _enum: "channel",
                    _ref: "channel",
                    _value: "mask",
                },
                new: {
                    _class: "channel",
                },
                using: {
                    _enum: "userMaskEnabled",
                    _value: "revealSelection",
                },
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const selectSubject = async (command) => {

    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `selectSubject : Could not find layerId : ${layerId}`
        );
    }

    return await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            // Select Subject
            {
                _obj: "autoCutout",
                sampleAllLayers: false,
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const selectSky = async (command) => {

    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(`selectSky : Could not find layerId : ${layerId}`);
    }

    return await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            // Select Sky
            {
                _obj: "selectSky",
                sampleAllLayers: false,
            },
        ];

        await action.batchPlay(commands, {});

    });
};

const cutSelectionToClipboard = async (command) => {

    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `cutSelectionToClipboard : Could not find layerId : ${layerId}`
        );
    }

    if (!hasActiveSelection()) {
        throw new Error(
            "cutSelectionToClipboard : Requires an active selection"
        );
    }

    return await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            {
                _obj: "cut",
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const copyMergedSelectionToClipboard = async (command) => {

    let options = command.options;

    if (!hasActiveSelection()) {
        throw new Error(
            "copySelectionToClipboard : Requires an active selection"
        );
    }

    return await execute(async () => {
        let commands = [{
            _obj: "copyMerged",
        }];

        await action.batchPlay(commands, {});
    });
};

const copySelectionToClipboard = async (command) => {

    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `copySelectionToClipboard : Could not find layerId : ${layerId}`
        );
    }

    if (!hasActiveSelection()) {
        throw new Error(
            "copySelectionToClipboard : Requires an active selection"
        );
    }

    return await execute(async () => {
        selectLayer(layer, true);

        let commands = [{
            _obj: "copyEvent",
            copyHint: "pixels",
        }];

        await action.batchPlay(commands, {});
    });
};

const pasteFromClipboard = async (command) => {

    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `pasteFromClipboard : Could not find layerId : ${layerId}`
        );
    }

    return await execute(async () => {
        selectLayer(layer, true);

        let pasteInPlace = options.pasteInPlace;

        let commands = [
            {
                _obj: "paste",
                antiAlias: {
                    _enum: "antiAliasType",
                    _value: "antiAliasNone",
                },
                as: {
                    _class: "pixel",
                },
                inPlace: pasteInPlace,
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const deleteSelection = async (command) => {

    let options = command.options;
    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `deleteSelection : Could not find layerId : ${layerId}`
        );
    }

    if (!app.activeDocument.selection.bounds) {
        throw new Error(`invertSelection : Requires an active selection`);
    }

    await execute(async () => {
        selectLayer(layer, true);
        let commands = [
            {
                _obj: "delete",
            },
        ];
        await action.batchPlay(commands, {});
    });
};

const fillSelection = async (command) => {

    let options = command.options;
    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `fillSelection : Could not find layerId : ${layerId}`
        );
    }

    if (!app.activeDocument.selection.bounds) {
        throw new Error(`invertSelection : Requires an active selection`);
    }

    await execute(async () => {
        selectLayer(layer, true);

        let c = parseColor(options.color).rgb;
        let commands = [
            // Fill
            {
                _obj: "fill",
                color: {
                    _obj: "RGBColor",
                    blue: c.blue,
                    grain: c.green,
                    red: c.red,
                },
                mode: {
                    _enum: "blendMode",
                    _value: options.blendMode.toLowerCase(),
                },
                opacity: {
                    _unit: "percentUnit",
                    _value: options.opacity,
                },
                using: {
                    _enum: "fillContents",
                    _value: "color",
                },
            },
        ];
        await action.batchPlay(commands, {});
    });
};

const selectPolygon = async (command) => {

    let options = command.options;
    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `selectPolygon : Could not find layerId : ${layerId}`
        );
    }

    await execute(async () => {

        selectLayer(layer, true);

        await app.activeDocument.selection.selectPolygon(
            options.points,
            constants.SelectionType.REPLACE,
            options.feather,
            options.antiAlias
        );
    });
};

let selectEllipse = async (command) => {

    let options = command.options;
    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `selectEllipse : Could not find layerId : ${layerId}`
        );
    }

    await execute(async () => {

        selectLayer(layer, true);

        await app.activeDocument.selection.selectEllipse(
            options.bounds,
            constants.SelectionType.REPLACE,
            options.feather,
            options.antiAlias
        );
    });
};

const selectRectangle = async (command) => {
    let options = command.options;
    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `selectRectangle : Could not find layerId : ${layerId}`
        );
    }

    await execute(async () => {
        selectLayer(layer, true);

        await app.activeDocument.selection.selectRectangle(
            options.bounds,
            constants.SelectionType.REPLACE,
            options.feather,
            options.antiAlias
        );
    });
};

const stampVisible = async (command) => {
    return await execute(async () => {
        const doc = app.activeDocument;
        const options = command.options || {};
        const layerName = options.layerName || "Stamped Visible";

        // 1. Select the full canvas
        await doc.selection.selectAll();

        // 2. Copy merged (composites all visible layers)
        await action.batchPlay([{ _obj: "copyMerged" }], {});

        // 3. Deselect before paste
        await action.batchPlay([{
            _obj: "set",
            _target: [{ _ref: "channel", _property: "selection" }],
            to: { _enum: "ordinal", _value: "none" }
        }], {});

        // 4. Paste in place — always creates a NEW layer as the active layer
        await action.batchPlay([{
            _obj: "paste",
            antiAlias: { _enum: "antiAliasType", _value: "antiAliasNone" },
            as: { _class: "pixel" },
            inPlace: true
        }], {});

        // 5. Rename the new layer
        const newLayer = doc.activeLayers[0];
        newLayer.name = layerName;

        return {
            layerId: newLayer.id,
            layerName: newLayer.name,
            message: "Stamped all visible layers to a new layer"
        };
    });
};

const selectLayerTransparency = async (command) => {
    return await execute(async () => {
        const doc = app.activeDocument;
        const options = command.options || {};
        const layerId = options.layerId;
        const invert = options.invert !== undefined ? options.invert : true;

        // Select the target layer
        const layer = findLayer(layerId);
        if (!layer) {
            throw new Error(`selectLayerTransparency: Could not find layer with ID ${layerId}`);
        }
        selectLayer(layer, true);

        // Load the layer's transparency as selection (selects opaque pixels)
        await action.batchPlay([{
            _obj: "set",
            _target: [{ _ref: "channel", _property: "selection" }],
            to: {
                _ref: "channel",
                _enum: "channel",
                _value: "transparencyEnum"
            },
            _options: { dialogOptions: "dontDisplay" }
        }], {});

        // Check if there's a selection
        const hasSel = !!doc.selection?.bounds;

        if (!hasSel) {
            // No opaque pixels at all — layer is fully transparent
            return {
                hasTransparency: true,
                hasSelection: false,
                message: "Layer is fully transparent — no opaque pixels to select"
            };
        }

        if (invert) {
            // Invert so transparent areas become the selection
            await action.batchPlay([{ _obj: "inverse" }], {});

            const hasTransparency = !!doc.selection?.bounds;
            if (!hasTransparency) {
                return {
                    hasTransparency: false,
                    hasSelection: false,
                    message: "Layer is fully opaque — no transparency"
                };
            }
            const bounds = doc.selection.bounds;
            return {
                hasTransparency: true,
                hasSelection: true,
                selectionBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                }
            };
        } else {
            // Return opaque areas as the selection
            const bounds = doc.selection.bounds;
            return {
                hasTransparency: false,
                hasSelection: true,
                selectionBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                },
                message: "Opaque pixels selected"
            };
        }
    });
};

const selectCompositeTransparency = async (command) => {
    return await execute(async () => {
        const doc = app.activeDocument;

        // 1. Stamp visible layers to a temp layer
        await doc.selection.selectAll();
        await action.batchPlay([{ _obj: "copyMerged" }], {});
        await action.batchPlay([{
            _obj: "set",
            _target: [{ _ref: "channel", _property: "selection" }],
            to: { _enum: "ordinal", _value: "none" }
        }], {});
        await action.batchPlay([{
            _obj: "paste",
            antiAlias: { _enum: "antiAliasType", _value: "antiAliasNone" },
            as: { _class: "pixel" },
            inPlace: true
        }], {});

        // 2. Load temp layer's transparency as selection
        await action.batchPlay([{
            _obj: "set",
            _target: [{ _ref: "channel", _property: "selection" }],
            to: {
                _ref: "channel",
                _enum: "channel",
                _value: "transparencyEnum"
            },
            _options: { dialogOptions: "dontDisplay" }
        }], {});

        // 3. Delete the temp layer
        await action.batchPlay([{
            _obj: "delete",
            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }]
        }], {});

        // 4. Check and invert
        const hasSel = !!doc.selection?.bounds;

        if (hasSel) {
            await action.batchPlay([{ _obj: "inverse" }], {});

            const hasTransparency = !!doc.selection?.bounds;
            if (!hasTransparency) {
                return { hasTransparency: false, message: "Document is fully opaque — no transparency" };
            }
            const bounds = doc.selection.bounds;
            return {
                hasTransparency: true,
                selectionBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                }
            };
        } else {
            return { hasTransparency: true, message: "Document appears fully transparent" };
        }
    });
};

const expandSelection = async (command) => {
    const options = command.options || {};
    const pixels = options.pixels || 10;

    if (!app.activeDocument.selection.bounds) {
        throw new Error(`expandSelection : Requires an active selection`);
    }

    return await execute(async () => {
        await action.batchPlay([{
            _obj: "expand",
            by: { _unit: "pixelUnit", _value: pixels },
            selectionModifyEffectAtCanvasBounds: false
        }], {});

        const bounds = app.activeDocument.selection.bounds;
        return {
            selectionBounds: {
                left: bounds.left,
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom
            }
        };
    });
};

const contractSelection = async (command) => {
    const options = command.options || {};
    const pixels = options.pixels || 10;

    if (!app.activeDocument.selection.bounds) {
        throw new Error(`contractSelection : Requires an active selection`);
    }

    return await execute(async () => {
        await action.batchPlay([{
            _obj: "contract",
            by: { _unit: "pixelUnit", _value: pixels },
            selectionModifyEffectAtCanvasBounds: false
        }], {});

        const hasSel = !!app.activeDocument.selection?.bounds;
        if (!hasSel) {
            return { message: "Selection contracted to nothing" };
        }
        const bounds = app.activeDocument.selection.bounds;
        return {
            selectionBounds: {
                left: bounds.left,
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom
            }
        };
    });
};

const invertSelection = async (command) => {

    if (!app.activeDocument.selection.bounds) {
        throw new Error(`invertSelection : Requires an active selection`);
    }

    await execute(async () => {
        let commands = [
            {
                _obj: "inverse",
            },
        ];
        await action.batchPlay(commands, {});
    });
};

const commandHandlers = {
    clearSelection,
    createMaskFromSelection,
    selectSubject,
    selectSky,
    cutSelectionToClipboard,
    copyMergedSelectionToClipboard,
    copySelectionToClipboard,
    pasteFromClipboard,
    deleteSelection,
    fillSelection,
    selectPolygon,
    selectEllipse,
    selectRectangle,
    invertSelection,
    expandSelection,
    contractSelection,
    stampVisible,
    selectLayerTransparency,
    selectCompositeTransparency
};

module.exports = {
    commandHandlers
};