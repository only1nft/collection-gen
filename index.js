import fs from "fs";
import sharp from "sharp";
import ProgressBar from "progress";
import { shuffle, times } from "./utils.js";

function resetOutputs() {
  fs.rmSync("./outputs", { recursive: true, force: true });
  fs.mkdirSync("./outputs/metadata", { recursive: true });
  fs.mkdirSync("./outputs/images", { recursive: true });
  fs.mkdirSync("./outputs/previews", { recursive: true });
}

function validateConfig() {
  config.attributes.forEach(({ attribute, variants }) => {
    const sum = variants.reduce((acc, { allocPct }) => acc + allocPct, 0);
    if (sum !== 100) {
      throw new Error(
        `Attribute ${attribute} allocation % sum must be equal 100`
      );
    }
  });
}

function buildLayersToDistribute() {
  const { attributes, supply } = config;
  const result = [];
  attributes.forEach((attribute, i) => {
    result[i] = [];
    attribute.variants.forEach((variant, j) => {
      let n;
      if (j === attribute.variants.length - 1) {
        if (n + result[i].length > supply) {
          throw new Error("adjust allocation");
        } else {
          n = supply - result[i].length;
        }
      } else {
        n = Math.floor((supply / 100) * variant.allocPct);
      }
      times(n, () => {
        result[i].push(`${attribute.name}/${variant.name}`);
      });
    });
    result[i] = shuffle(result[i], 10);
  });
  return result;
}

resetOutputs();
const config = JSON.parse(fs.readFileSync("./inputs/config.json"));
validateConfig();

function filePath(key) {
  return `./inputs/layers/${key}.png`;
}

let outCsv;
let generated;

const { supply, attributes } = config;
for (let attempt = 1; ; attempt++) {
  const layersToDistribute = buildLayersToDistribute();
  const genProgress = new ProgressBar(
    `[${attempt}] Generating (:current/:total) [:bar] :percent :etas`,
    {
      total: supply,
      width: 50,
    }
  );
  generated = [];
  outCsv = [["ID", ...attributes.map((attribute) => attribute.name)]];
  try {
    for (let i = 0; i < supply; i++) {
      const layers = [];
      const exceptions = config.avoidCombinations.map((attributes) => ({
        matched: false,
        attributes,
      }));
      attributes.forEach((attribute, j) => {
        const selectedVarIndex = layersToDistribute[j].findIndex((variant) => {
          const passesExceptions = exceptions
            .filter((exc) => exc.matched)
            .every((exc) => {
              if (exc.attributes.includes(variant)) {
                return false;
              }
              if (
                exc.attributes.find(
                  (a) =>
                    a.includes("/!") &&
                    a.startsWith(attribute.name) &&
                    a.replace("/!", "/") !== variant
                )
              ) {
                return false;
              }
              return true;
            });
          exceptions.forEach((exc) => {
            if (!exc.matched && exc.attributes.includes(variant)) {
              exc.matched = true;
            }
          });
          if (!passesExceptions) {
            return false;
          }
          if (
            layers.length >=
            config.attributes.length - config.minUniqueAttributes
          ) {
            const isDup = generated.some((g) =>
              [...layers, variant].every((l) => g.includes(l))
            );
            return !isDup;
          }
          return true;
        });
        if (selectedVarIndex === -1) {
          throw new Error(
            `Failed to select a layer for "${
              attribute.name
            }" with layers ${JSON.stringify(layers)}`
          );
        }
        const layer = layersToDistribute[j][selectedVarIndex];
        layersToDistribute[j].splice(selectedVarIndex, 1);
        layers.push(layer);
      });
      const layersPassExc = config.avoidCombinations
        .filter((exc) => exc.some((e) => layers.includes(e)))
        .every((exc) => {
          const matchCount = exc.reduce((acc, a) => {
            const hasAttr = layers.includes(a.replace("/!", "/"));
            if (a.includes("/!")) {
              return acc;
            }
            return !hasAttr ? acc : acc + 1;
          }, 0);
          const isValid = matchCount <= 1;
          if (!isValid) {
            console.error("failed layer validation", { layers, exc });
          }
          return isValid;
        });
      if (!layersPassExc) {
        throw new Error("layers validation failed");
      }
      const isDup = generated.some((prevLayers) =>
        prevLayers.every((l) => layers.includes(l))
      );
      if (isDup) {
        throw new Error("duplicate error");
      }
      generated.push(layers);
      genProgress.tick();
    }
    break;
  } catch (error) {
    genProgress.terminate();
    console.error("Attempt failed:", error.message);
  }
}

generated = shuffle(generated, 100);

const saveProgress = new ProgressBar(
  "Saving results (:current/:total) [:bar] :percent :etas",
  {
    total: supply,
    width: 50,
  }
);

// Pre-cache all layers
const inputs = {};
for (let i = 0; i < config.attributes.length; i++) {
  const attr = config.attributes[i];
  for (let j = 0; j < attr.variants.length; j++) {
    const key = `${attr.name}/${attr.variants[j].name}`;
    inputs[key] = fs.readFileSync(filePath(key));
  }
}

// Save generated results
for (let i = 0; i < generated.length; i++) {
  const layers = generated[i];
  const id = i + 1;
  outCsv.push([id, ...layers.map((l) => l.split("/")[1])]);

  const img = await sharp(inputs[layers[0]])
    .composite(layers.slice(1).map((layer) => ({ input: inputs[layer] })))
    .toBuffer();

  await Promise.all([
    fs.promises.writeFile(
      `./outputs/metadata/${id}.json`,
      JSON.stringify({
        name: `Secret Skellies Society #${id}`,
        symbol: "SSS",
        description: `An immutable collection of 5001 NFTs. Home of the multi chain iOS and Android app "Skellieverse" bridging NFT communities from Solana/Near and Ethereum.`,
        seller_fee_basis_points: 600,
        external_url: "https://secretskelliessociety.com",
        image: "",
        attributes: [
          ...layers.map((l) => ({
            trait_type: l.split("/")[0],
            value: l.split("/")[1],
          })),
        ],
      })
    ),

    sharp(img).toFile(`./outputs/images/${id}.png`),

    sharp(img)
      .resize({ width: 600, height: 600 })
      .toFormat("webp")
      .toFile(`./outputs/previews/${id}.webp`),
  ]);

  saveProgress.tick();
}

// Save table
fs.writeFileSync(
  "./outputs/table.csv",
  outCsv.map((rows) => rows.join(",")).join("\n")
);
