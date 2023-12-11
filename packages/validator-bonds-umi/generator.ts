import { createFromIdls, GetNodeTreeStringVisitor, RenderJavaScriptVisitor, UpdateProgramsVisitor } from "@metaplex-foundation/kinobi";
import path from "path";
import * as generated from '../validator-bonds-sdk/generated/validator_bonds'

// Instantiate Kinobi.
const idlPath = path.join(__dirname, "..", "..",  "target", "idl", "validator_bonds.json")
console.log("Loading IDL from", idlPath);
const kinobi = createFromIdls([idlPath])

// Loading Typescript IDL to load program ID constant
export const VALIDATOR_BONDS_PROGRAM_ID =  JSON.parse(generated.IDL.constants.find(x => x.name === 'PROGRAM_ID')!.value)

// Update the Kinobi tree using visitors...
kinobi.update(
  new UpdateProgramsVisitor({
    "validator_bonds": {
      publicKey: VALIDATOR_BONDS_PROGRAM_ID,
      origin: "anchor"
    }
  })
)

// Render JavaScript.
console.log("Rendering JavaScript...");
const jsDir = path.join(__dirname, "src");
kinobi.accept(new RenderJavaScriptVisitor(jsDir));