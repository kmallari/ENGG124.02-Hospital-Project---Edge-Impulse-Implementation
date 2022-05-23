// Load the inferencing WebAssembly module
const Module = require("./edge-impulse-standalone");
const fs = require("fs");

const Firebase = require("./node_modules/firebase/compat/app");
const FireStore = require("./node_modules/firebase/compat/firestore");

const firebaseConfig = {
  apiKey: "AIzaSyBA3FAnNkcWf8dvf9_MeBnwc7nNf-HkY3k",
  authDomain: "hospital-playlist.firebaseapp.com",
  projectId: "hospital-playlist",
  storageBucket: "hospital-playlist.appspot.com",
  messagingSenderId: "765469232623",
  appId: "1:765469232623:web:1394c2778c2d278ab43a1a",
  measurementId: "G-X2FW0RLMT0",
};

const app = Firebase.initializeApp(firebaseConfig);

//const Firebase = require('./firebase');

// Classifier module
let classifierInitialized = false;
Module.onRuntimeInitialized = function () {
  classifierInitialized = true;
};

class EdgeImpulseClassifier {
  _initialized = false;

  init() {
    if (classifierInitialized === true) return Promise.resolve();

    return new Promise((resolve) => {
      Module.onRuntimeInitialized = () => {
        resolve();
        classifierInitialized = true;
      };
    });
  }

  getProjectInfo() {
    if (!classifierInitialized) throw new Error("Module is not initialized");
    return Module.get_project();
  }

  classify(rawData, debug = false) {
    if (!classifierInitialized) throw new Error("Module is not initialized");

    let props = Module.get_properties();

    const obj = this._arrayToHeap(rawData);
    let ret = Module.run_classifier(
      obj.buffer.byteOffset,
      rawData.length,
      debug
    );
    Module._free(obj.ptr);

    if (ret.result !== 0) {
      throw new Error("Classification failed (err code: " + ret.result + ")");
    }

    let jsResult = {
      anomaly: ret.anomaly,
      results: [],
    };

    for (let cx = 0; cx < ret.size(); cx++) {
      let c = ret.get(cx);
      if (
        props.model_type === "object_detection" ||
        props.model_type === "constrained_object_detection"
      ) {
        jsResult.results.push({
          label: c.label,
          value: c.value,
          x: c.x,
          y: c.y,
          width: c.width,
          height: c.height,
        });
      } else {
        jsResult.results.push({ label: c.label, value: c.value });
      }
      c.delete();
    }

    ret.delete();

    return jsResult;
  }

  getProperties() {
    return Module.get_properties();
  }

  _arrayToHeap(data) {
    let typedArray = new Float32Array(data);
    let numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
    let ptr = Module._malloc(numBytes);
    let heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, numBytes);
    heapBytes.set(new Uint8Array(typedArray.buffer));
    return { ptr: ptr, buffer: heapBytes };
  }
}
/*
if (!process.argv[2]) {
    return console.error('Requires one parameter (a comma-separated list of raw features, or a file pointing at raw features)');
}*/

let features = process.argv[2];
if (fs.existsSync(features)) {
  features = fs.readFileSync(features, "utf-8");
}

// Initialize the classifier, and invoke with the argument passed in
let classifier = new EdgeImpulseClassifier();
classifier
  .init()
  .then(async () => {
    let project = classifier.getProjectInfo();
    console.log(
      "Running inference for",
      project.owner +
        " / " +
        project.name +
        " (version " +
        project.deploy_version +
        ")"
    );

    let result = classifier.classify(
      features
        .trim()
        .split(",")
        .map((n) => Number(n))
    );

    console.log(result);
    console.log(result.results[0].value);

    // Put values in one array and get max
    // Wherever the index with highest value is = Classification
    // 0: Fell Fall
    // 1: Fell Sidewards
    // 2: Stable
    // 3: Standing Up

    let maxPrediction = -Infinity;
    let classification;

    for (let i = 0; i < result.results.length; i++) {
      if (i == 0) {
        maxPrediction = -Infinity;
      }

      if (result.results[i].value > maxPrediction) {
        classification = result.results[i].label;
        maxPrediction = result.results[i].value;
      }
    }

    console.log("label: ", classification);
    console.log("maxPrediction: ", maxPrediction);

    const classifications = {
      "fall-flat": "Fall Flat",
      "fall-side": "Fall Side",
      "stable": "Stable",
      "stand-up": "Stand Up",
    };

    // Update
    await Firebase.firestore().collection("patients").doc("patient1").update({
      status: classifications[classification],
    });

    app.delete();

    /* //Adding
    db.collection("patients").add({
        name: "Name",
        age: 12,
        id: 4,
        status: "Stable"
    }); */
  })
  .catch((err) => {
    console.error("Failed to initialize classifier", err);
  });
