import { createFromIdls, RenderJavaScriptVisitor, UpdateProgramsVisitor } from "@metaplex-foundation/kinobi";
import path from "path";

// Instantiate Kinobi.
const idlPath = path.join(__dirname, "..", "..",  "target", "idl", "validator_bonds.json")
console.log("Loading IDL from", idlPath);
const kinobi = createFromIdls([idlPath])

// Update the Kinobi tree using visitors...
kinobi.update(
  new UpdateProgramsVisitor({
    "validator_bonds": {publicKey: "vbondsKbsC4QSLQQnn6ngZvkqfywn6KgEeQbkGSpk1V"}
  })
)

console.log(kinobi.getJson());

// Render JavaScript.
console.log("Rendering JavaScript...");
const jsDir = path.join(__dirname, "src");
kinobi.accept(new RenderJavaScriptVisitor(jsDir));