import { createFromIdls, payerDefault, AutoSetAnchorDiscriminatorsVisitor, SetInstructionAccountDefaultValuesVisitor, RenderJavaScriptVisitor, UpdateProgramsVisitor } from "@metaplex-foundation/kinobi";
import path from "path";
import * as generated from '../validator-bonds-sdk/generated/validator_bonds'
import fs from "fs";

// Instantiate Kinobi.
const jsonFile = 'validator_bonds.json'
const idlPath = path.join(__dirname, "..", "..",  "target", "idl", jsonFile)

// Loading Typescript IDL to load program ID constant
export const VALIDATOR_BONDS_PROGRAM_ID =  JSON.parse(generated.IDL.constants.find(x => x.name === 'PROGRAM_ID')!.value)

// // Update the IDL before loading it
// // An option to define metadata into IDL directly
// // https://discord.com/channels/889577356681945098/889577399308656662/1183766957477089320
// const idl = fs.readFileSync(idlPath, "utf8");
// const idlJson = JSON.parse(idl);
// if(!idlJson.metadata) {
//     idlJson.metadata = {
//         "address": VALIDATOR_BONDS_PROGRAM_ID,
//         "origin": "anchor"
//     };
// }
// const dir = fs.mkdtempSync('umi-generator')
// const newIdlPath = path.join(dir, jsonFile)
// fs.writeFileSync(newIdlPath, JSON.stringify(idlJson, null, 2));

console.log("Loading IDL from", idlPath);
const kinobi = createFromIdls([idlPath])

// Update the Kinobi tree using visitors...
kinobi.update(
  new UpdateProgramsVisitor({
    "validator_bonds": {
      publicKey: VALIDATOR_BONDS_PROGRAM_ID,
      origin: "anchor"
    }
  })
)
// We need to have the anchor discriminator visitor defined
// as the `origin: anchor` is set only after `createFromIdls` is called
// thus it's not taken into account in the `createFromIdls` call
kinobi.update(
  new AutoSetAnchorDiscriminatorsVisitor()
)
// Set default values for instruction accounts.
kinobi.update(
  new SetInstructionAccountDefaultValuesVisitor([
    {
      account: "rentPayer",
      ...payerDefault(),
    },
  ])
);

// Render JavaScript.
console.log("Rendering JavaScript...");
const jsDir = path.join(__dirname, "src");
kinobi.accept(new RenderJavaScriptVisitor(jsDir));