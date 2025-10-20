# RELEASE notes

## Testing

On how to test the CLI will work properly when released.

- Checking what are files to be published

  ```sh
  pnpm publish --dry-run
  ```

- Checking how the publish data looks like

  ```sh
  # clean the dist directory
  rm -rf dist/
  # build and generate dist/ directory that will be published
  pnpm build
  cd dist/
  # generated .tgz file that is uploaded to npm registry
  pnpm pack
  ```

- Checking publish process and CLI installation
  - Check currently configured registry
    ```sh
    npm config get registry
    > https://registry.npmjs.org/
    ```
  - Installing local registry

    ```sh
    # Run local registry
    npm install -g verdaccio
    # Remove all verdaccio data to start clean
    rm -rf ~/.config/verdaccio
    rm -rf ~/.local/share/verdaccio/
    npm cache clean '@marinade.finance'

    # Start local registry
    verdaccio

    # Configure npm and pnpm to use the local registry
    npm config set registry http://localhost:4873/

    # Required to add a user for the registry and authenticate (required password in form like "Test123!")
    npm adduser --registry http://localhost:4873/
    ```

  - To check where the CLI is installed

    ```sh
    npm root -g
    ```

  - Publish and check CLI

    ```sh
    cd <root>
    pnpm publish:all

    # when not working then publish each package separately
    ```

  - Install the CLI globally and check the version

    ```sh
    npm install -g @marinade.finance/validator-bonds-cli
    validator-bonds --version

    npm install -g @marinade.finance/validator-bonds-cli-institutional
    validator-bonds-institutional --version
    ```

- Configure the registry back for both npm

  ```sh
  npm config set registry https://registry.npmjs.org/

  npm config get registry
  ```
