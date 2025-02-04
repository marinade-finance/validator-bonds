#!/bin/bash

SCRIPT_PATH=`readlink -f "$0"`
SCRIPT_DIR=`dirname "$SCRIPT_PATH"`

SDK_PACKAGE_JSON="$SCRIPT_DIR/../packages/validator-bonds-sdk/package.json"
CLI_PACKAGE_JSON="$SCRIPT_DIR/../packages/validator-bonds-cli/package.json"
CLI_CORE_PACKAGE_JSON="$SCRIPT_DIR/../packages/validator-bonds-cli-core/package.json"
CLI_INSTITUTIONAL_PACKAGE_JSON="$SCRIPT_DIR/../packages/validator-bonds-cli-institutional/package.json"
PIPELINES_PACKAGE_JSON="$SCRIPT_DIR/../settlement-pipelines/package.json"
CLI_INDEX="$SCRIPT_DIR/../packages/validator-bonds-cli/src/index.ts"
README="$SCRIPT_DIR/../README.md"
README_CLI="$SCRIPT_DIR/../packages/validator-bonds-cli/README.md"
README_INSTITUTIONAL_CLI="$SCRIPT_DIR/../packages/validator-bonds-cli-institutional/README.md"

VERSION=`cat $SDK_PACKAGE_JSON | grep version | cut -d '"' -f 4`
ESCAPED_VERSION=$(echo $VERSION | sed 's/\./\\./g')
NEW_VERSION=`echo $VERSION | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g'`
NEW_VERSION=${1:-$NEW_VERSION}

echo "Updating CLI version $VERSION to $NEW_VERSION"
read -p "Press enter to continue"

# A fix/hack of issue on pnpm publish that does not comply with npm publishing and usage
# https://github.com/pnpm/pnpm/issues/4348
sed -i 's/workspace://' "$CLI_PACKAGE_JSON"

for I in "$SDK_PACKAGE_JSON" "$CLI_CORE_PACKAGE_JSON" "$CLI_PACKAGE_JSON" "$CLI_INSTITUTIONAL_PACKAGE_JSON" "$PIPELINES_PACKAGE_JSON" "$CLI_INDEX" "$README" "$README_CLI" "$README_INSTITUTIONAL_CLI"; do
    UPDATE_FILE=`readlink -f "$I"`
    echo "Updating ${UPDATE_FILE}"
    sed -i "s/$ESCAPED_VERSION/$NEW_VERSION/" "$UPDATE_FILE"
done

if [ -e "./package.json" ]; then
    pnpm install
    pnpm cli --version
fi

echo "Done"
