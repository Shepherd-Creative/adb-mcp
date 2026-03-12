/* MIT License
 *
 * Copyright (c) 2025 Mike Chambers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const { app, constants, action, imaging } = require("photoshop");
const fs = require("uxp").storage.localFileSystem;

const {
    _saveDocumentAs,
    parseColor,
    getAlignmentMode,
    getNewDocumentMode,
    selectLayer,
    findLayer,
    findLayerByName,
    execute,
    tokenify,
    hasActiveSelection,
    listOpenDocuments
} = require("./utils");

const { rasterizeLayer } = require("./layers").commandHandlers;

const openFile = async (command) => {
    let options = command.options;

    await execute(async () => {
        let entry = null;
        try {
            entry = await fs.getEntryWithUrl("file:" + options.filePath);
        } catch (e) {
            throw new Error(
                "openFile: Could not create file entry. File probably does not exist."
            );
        }

        await app.open(entry);
    });
};

const placeImage = async (command) => {
    let options = command.options;
    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(`placeImage : Could not find layerId : ${layerId}`);
    }

    await execute(async () => {
        selectLayer(layer, true);
        let layerId = layer.id;

        let imagePath = await tokenify(options.imagePath);

        let commands = [
            // Place
            {
                ID: layerId,
                _obj: "placeEvent",
                freeTransformCenterState: {
                    _enum: "quadCenterState",
                    _value: "QCSAverage",
                },
                null: {
                    _kind: "local",
                    _path: imagePath,
                },
                offset: {
                    _obj: "offset",
                    horizontal: {
                        _unit: "pixelsUnit",
                        _value: 0.0,
                    },
                    vertical: {
                        _unit: "pixelsUnit",
                        _value: 0.0,
                    },
                },
                replaceLayer: {
                    _obj: "placeEvent",
                    to: {
                        _id: layerId,
                        _ref: "layer",
                    },
                },
            },
        ];

        await action.batchPlay(commands, {});
        // Rasterize the currently active layer (the newly placed smart object)
        await action.batchPlay([{
            _obj: "rasterizeLayer",
            _target: [{ _enum: "ordinal", _ref: "layer", _value: "targetEnum" }]
        }], {});
        // Rename the placed layer to something descriptive
        let placedLayer = app.activeDocument.activeLayers[0];
        if (placedLayer) {
            placedLayer.name = options.layerName || `Placed Image`;
        }
    });
};

const getDocumentImage = async (command) => {
    let out = await execute(async () => {

        const pixelsOpt = {
            applyAlpha: true
        };

        const imgObj = await imaging.getPixels(pixelsOpt);

        const base64Data = await imaging.encodeImageData({
            imageData: imgObj.imageData,
            base64: true,
        });

        const result = {
            base64Image: base64Data,
            dataUrl: `data:image/jpeg;base64,${base64Data}`,
            width: imgObj.imageData.width,
            height: imgObj.imageData.height,
            colorSpace: imgObj.imageData.colorSpace,
            components: imgObj.imageData.components,
            format: "jpeg",
        };

        imgObj.imageData.dispose();
        return result;
    });

    return out;
};

const getDocumentInfo = async (command) => {
    let doc = app.activeDocument;
    let path = doc.path;

    let out = {
        height: doc.height,
        width: doc.width,
        colorMode: doc.mode.toString(),
        pixelAspectRatio: doc.pixelAspectRatio,
        resolution: doc.resolution,
        path: path,
        saved: path.length > 0,
        hasUnsavedChanges: !doc.saved,
    };

    return out;
};

const cropDocument = async (command) => {
    let options = command.options;

    if (!hasActiveSelection()) {
        throw new Error("cropDocument : Requires an active selection");
    }

    return await execute(async () => {
        let commands = [
            // Crop
            {
                _obj: "crop",
                delete: true,
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const removeBackground = async (command) => {
    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `removeBackground : Could not find layerId : ${layerId}`
        );
    }

    await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            // Remove Background
            {
                _obj: "removeBackground",
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const alignContent = async (command) => {
    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `alignContent : Could not find layerId : ${layerId}`
        );
    }

    if (!app.activeDocument.selection.bounds) {
        throw new Error(`alignContent : Requires an active selection`);
    }

    await execute(async () => {
        let m = getAlignmentMode(options.alignmentMode);

        selectLayer(layer, true);

        let commands = [
            {
                _obj: "align",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "layer",
                        _value: "targetEnum",
                    },
                ],
                alignToCanvas: false,
                using: {
                    _enum: "alignDistributeSelector",
                    _value: m,
                },
            },
        ];
        await action.batchPlay(commands, {});
    });
};

const generateImage = async (command) => {
    let options = command.options;

    await execute(async () => {
        let doc = app.activeDocument;

        await doc.selection.selectAll();

        let contentType = "none";
        const c = options.contentType.toLowerCase()
        if (c === "photo" || c === "art") {
            contentType = c;
        }

        let commands = [
            // Generate Image current document
            {
                _obj: "syntheticTextToImage",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "document",
                        _value: "targetEnum",
                    },
                ],
                documentID: doc.id,
                layerID: 0,
                prompt: options.prompt,
                serviceID: "clio",
                serviceOptionsList: {
                    clio: {
                        _obj: "clio",
                        clio_advanced_options: {
                            text_to_image_styles_options: {
                                text_to_image_content_type: contentType,
                                text_to_image_effects_count: 0,
                                text_to_image_effects_list: [
                                    "none",
                                    "none",
                                    "none",
                                ],
                            },
                        },
                        dualCrop: true,
                        gentech_workflow_name: "text_to_image",
                        gi_ADVANCED: '{"enable_mts":true}',
                        gi_CONTENT_PRESERVE: 0,
                        gi_CROP: false,
                        gi_DILATE: false,
                        gi_ENABLE_PROMPT_FILTER: true,
                        gi_GUIDANCE: 6,
                        gi_MODE: "ginp",
                        gi_NUM_STEPS: -1,
                        gi_PROMPT: options.prompt,
                        gi_SEED: -1,
                        gi_SIMILARITY: 0,
                    },
                },
                workflow: "text_to_image",
                workflowType: {
                    _enum: "genWorkflow",
                    _value: "text_to_image",
                },
            },
            // Rasterize current layer
            {
                _obj: "rasterizeLayer",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "layer",
                        _value: "targetEnum",
                    },
                ],
            },
        ];
        let o = await action.batchPlay(commands, {});
        let layerId = o[0].layerID;

        if (layerId) {
            let l = findLayer(layerId);
            if (l) {
                l.name = options.layerName;
            }
        }
    });
};

const generativeFill = async (command) => {
    const options = command.options;
    const layerId = options.layerId;
    const prompt = options.prompt;

    const layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `generativeFill : Could not find layerId : ${layerId}`
        );
    }

    if(!hasActiveSelection()) {
        throw new Error(
            `generativeFill : Requires an active selection.`
        ); 
    }

    await execute(async () => {
        let doc = app.activeDocument;

        let contentType = "none";
        const c = options.contentType.toLowerCase()
        if (c === "photo" || c === "art") {
            contentType = c;
        }

        let commands = [
            // Generative Fill current document
            {
                "_obj": "syntheticFill",
                "_target": [
                    {
                        "_enum": "ordinal",
                        "_ref": "document",
                        "_value": "targetEnum"
                    }
                ],
                "documentID": doc.id,
                "layerID": layerId,
                "prompt": prompt,
                "serviceID": "clio",
                "serviceOptionsList": {
                    "clio": {
                        "_obj": "clio",
                        "dualCrop": true,
                        "gi_ADVANCED": "{\"enable_mts\":true}",
                        "gi_CONTENT_PRESERVE": 0,
                        "gi_CROP": false,
                        "gi_DILATE": false,
                        "gi_ENABLE_PROMPT_FILTER": true,
                        "gi_GUIDANCE": 6,
                        "gi_MODE": "tinp",
                        "gi_NUM_STEPS": -1,
                        "gi_PROMPT": prompt,
                        "gi_SEED": -1,
                        "gi_SIMILARITY": 0,


                        clio_advanced_options: {
                            text_to_image_styles_options: {
                                text_to_image_content_type: contentType,
                                text_to_image_effects_count: 0,
                                text_to_image_effects_list: [
                                    "none",
                                    "none",
                                    "none",
                                ],
                            },
                        },

                    }
                },
                "serviceVersion": "clio3",
                "workflowType": {
                    "_enum": "genWorkflow",
                    "_value": "in_painting"
                },
                "workflow_to_active_service_identifier_map": {
                    "gen_harmonize": "clio3",
                    "generate_background": "clio3",
                    "generate_similar": "clio3",
                    "generativeUpscale": "fal_aura_sr",
                    "in_painting": "clio3",
                    "instruct_edit": "clio3",
                    "out_painting": "clio3",
                    "text_to_image": "clio3"
                }
            }
        ];


        let o = await action.batchPlay(commands, {});
        let id = o[0].layerID;

        if (!id) {
            throw new Error(`generativeFill : Firefly did not return a layer. Response: ${JSON.stringify(o[0])}`);
        }

        let l = findLayer(id);
        if (l) {
            l.name = options.layerName;
        } else {
            throw new Error(`generativeFill : Generated layer ID ${id} not found in document.`);
        }
    });
};

const saveDocument = async (command) => {
    let doc = app.activeDocument;
    if (!doc.path || doc.path.length === 0) {
        throw new Error("saveDocument : Document has no save path. Use save_document_as to specify a file path first.");
    }
    await execute(async () => {
        await action.batchPlay([{ _obj: "save" }], {});
    });
};

const saveDocumentAs = async (command) => {
    let options = command.options;

    return await _saveDocumentAs(options.filePath, options.fileType);
};

const setActiveDocument = async (command) => {

    let options = command.options;
    let documentId = options.documentId;
    let docs = listOpenDocuments();

    for (let doc of docs) {
        if (doc.id === documentId) {
            await execute(async () => {
                app.activeDocument = doc;
            });

            return
        }
    }
}

const getDocuments = async (command) => {
    return listOpenDocuments()
}

const duplicateDocument = async (command) => {
    let options = command.options;
    let name = options.name

    await execute(async () => {
        const doc = app.activeDocument;
        await doc.duplicate(name)
    });
};

const createDocument = async (command) => {
    let options = command.options;
    let colorMode = getNewDocumentMode(command.options.colorMode);
    let fillColor = parseColor(options.fillColor);

    await execute(async () => {
        await app.createDocument({
            typename: "DocumentCreateOptions",
            width: options.width,
            height: options.height,
            resolution: options.resolution,
            mode: colorMode,
            fill: constants.DocumentFill.COLOR,
            fillColor: fillColor,
            profile: "sRGB IEC61966-2.1",
        });

        let background = findLayerByName("Background");
        background.allLocked = false;
        background.name = "Background";
    });
};

const executeBatchPlayCommand = async (commands) => {
    let options = commands.options;
    let c = options.commands;



    let out = await execute(async () => {
        let o = await action.batchPlay(c, {});
        return o[0]
    });

    console.log(out)
    return out;
}

const playActions = async (command) => {
    let options = command.options;
    let actions = options.actions;
    let applyToAll = options.applyToAll || false;

    if (!actions || !actions.length) {
        throw new Error("playActions : actions list cannot be empty");
    }

    const runOnActiveDoc = async () => {
        let results = [];
        for (let a of actions) {
            let playDescriptor = {
                _obj: "play",
                _target: [
                    { _ref: "action", _name: a.actionName },
                    { _ref: "actionSet", _name: a.actionSetName }
                ],
                _options: { dialogOptions: "dontDisplay" }
            };

            await execute(async () => {
                await action.batchPlay([playDescriptor], {});
            }, `Playing action: ${a.actionName}`);

            results.push({ action: a.actionName, status: "ok" });
        }
        return results;
    };

    if (!applyToAll) {
        return await runOnActiveDoc();
    }

    let docs = listOpenDocuments();
    let allResults = [];

    for (let i = 0; i < docs.length; i++) {
        let doc = docs[i];
        let docName = doc.name;
        try {
            await execute(async () => {
                app.activeDocument = doc;
            }, `Switching to: ${docName}`);

            let docResults = await runOnActiveDoc();
            allResults.push({ document: docName, status: "ok", actions: docResults });
        } catch (e) {
            allResults.push({ document: docName, status: "failed", error: e.message });
        }
    }

    return allResults;
};

const getHistoryStates = async (command) => {
    return await execute(async () => {
        let doc = app.activeDocument;
        let historyStates = doc.historyStates;
        let currentState = doc.activeHistoryState;

        let states = [];
        for (let i = 0; i < historyStates.length; i++) {
            let state = historyStates[i];
            states.push({
                index: i + 1,
                name: state.name,
                isCurrent: state.name === currentState.name && i === historyStates.length - 1
            });
        }

        // Find actual current state index
        let currentIndex = states.length;
        for (let i = states.length - 1; i >= 0; i--) {
            if (historyStates[i] === currentState) {
                currentIndex = i + 1;
                states[i].isCurrent = true;
                break;
            }
        }

        return {
            documentName: doc.name,
            currentStateIndex: currentIndex,
            totalStates: states.length,
            states: states
        };
    }, "Get History States");
};

const undoToHistoryState = async (command) => {
    let options = command.options;
    let targetStateName = options.stateName;
    let applyToAll = options.applyToAll || false;

    const revertOnActiveDoc = async () => {
        return await execute(async () => {
            let doc = app.activeDocument;
            let historyStates = doc.historyStates;

            // Find the LAST occurrence of the target state name
            let targetState = null;
            let targetIndex = -1;
            for (let i = historyStates.length - 1; i >= 0; i--) {
                if (historyStates[i].name === targetStateName) {
                    targetState = historyStates[i];
                    targetIndex = i + 1;
                    break;
                }
            }

            if (!targetState) {
                throw new Error(`History state "${targetStateName}" not found in ${doc.name}`);
            }

            // Set the active history state
            doc.activeHistoryState = targetState;

            return {
                documentName: doc.name,
                revertedTo: targetStateName,
                stateIndex: targetIndex
            };
        }, `Revert to: ${targetStateName}`);
    };

    if (!applyToAll) {
        return await revertOnActiveDoc();
    }

    let docs = listOpenDocuments();
    let allResults = [];

    for (let i = 0; i < docs.length; i++) {
        let doc = docs[i];
        let docName = doc.name;
        try {
            await execute(async () => {
                app.activeDocument = doc;
            }, `Switching to: ${docName}`);

            let result = await revertOnActiveDoc();
            allResults.push({ document: docName, status: "ok", revertedTo: result.revertedTo, stateIndex: result.stateIndex });
        } catch (e) {
            allResults.push({ document: docName, status: "failed", error: e.message });
        }
    }

    return allResults;
};

const commandHandlers = {
    getHistoryStates,
    undoToHistoryState,
    playActions,
    generativeFill,
    executeBatchPlayCommand,
    setActiveDocument,
    getDocuments,
    duplicateDocument,
    getDocumentImage,
    openFile,
    placeImage,
    getDocumentInfo,
    cropDocument,
    removeBackground,
    alignContent,
    generateImage,
    saveDocument,
    saveDocumentAs,
    createDocument,
};

module.exports = {
    commandHandlers,
};
