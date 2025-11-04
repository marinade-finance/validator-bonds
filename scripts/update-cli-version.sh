#!/bin/bash

SCRIPT_PATH=`readlink -f "$0"`
SCRIPT_DIR=`dirname "$SCRIPT_PATH"`

CLI_INDEX="$SCRIPT_DIR/../packages/validator-bonds-cli/src/index.ts"
CLI_INSTITUTIONAL_INDEX="$SCRIPT_DIR/../packages/validator-bonds-cli-institutional/src/index.ts"
README="$SCRIPT_DIR/../README.md"
README_CLI="$SCRIPT_DIR/../packages/validator-bonds-cli/README.md"
README_INSTITUTIONAL_CLI="$SCRIPT_DIR/../packages/validator-bonds-cli-institutional/README.md"

SDK_PACKAGE_JSON="$SCRIPT_DIR/../packages/validator-bonds-sdk/package.json"
[ ! -f "$SDK_PACKAGE_JSON" ] && echo "$SDK_PACKAGE_JSON not found" && exit 1
PREVIOUS_VERSION=`cat $SDK_PACKAGE_JSON | grep version | cut -d '"' -f 4`
PREVIOUS_ESCAPED_VERSION=$(echo $PREVIOUS_VERSION | sed 's/\./\\./g')

# update package.json minor version
for I in "$SCRIPT_DIR/../packages/"*sdk* "$SCRIPT_DIR/../packages/"*cli*; do
  echo "Package: $I"
  cd "$I"
  pnpm version patch
  cd -
done

NEW_VERSION=`cat $SDK_PACKAGE_JSON | grep version | cut -d '"' -f 4`

echo "$PREVIOUS_VERSION -> $NEW_VERSION"
for I in "$CLI_INDEX" "$CLI_INSTITUTIONAL_INDEX" "$README" "$README_CLI" "$README_INSTITUTIONAL_CLI"; do
    UPDATE_FILE=`readlink -f "$I"`
    echo "Updating ${UPDATE_FILE}"
    sed -i "s/$PREVIOUS_ESCAPED_VERSION/$NEW_VERSION/" "$UPDATE_FILE"
done

if [ -e "./package.json" ]; then
    pnpm install
    echo -n "pnpm cli version: "
    pnpm cli --version
fi

echo "Done"
