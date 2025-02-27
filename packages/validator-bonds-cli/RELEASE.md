# RELEASE notes

## Testing

On how to test the CLI will work properly when released.

* Checking what are files to be published
  ```sh
  pnpm publish --dry-run
  ```

* Checking how the publish data looks like
  ```sh
  # clean the dist directory
  rm -rf dist/
  # build and generate dist/ directory that will be published
  pnpm build
  cd dist/
  # generated .tgz file that is uploaded to npm registry
  pnpm pack
  ```

* Checking publish process and CLI installation
  * Check currently configured registry
    ```sh
    pnpm config get  registry
    > https://registry.npmjs.org/
    ```
  * Installing local registry
    ```sh
    # Run local registry
    pnpm install -g verdaccio
    # Remove all verdaccio data to start clean
    rm -rf ~/.config/verdaccio
    rm -rf ~/.local/share/verdaccio/
    pnpm cache clean '@marinade.finance'

    verdaccio
    # Configure npm/pnpm to use the local registry
    pnpm config set registry http://localhost:4873/
    # needed to authenticate (password has to be like Test123!)
    npm adduser --registry http://localhost:4873/ 
    ```
  * Publish and check CLI
    ```sh
    cd <root>
    pnpm publish:all
    pnpm install -g @marinade.finance/validator-bonds-cli
    validator-bonds --version
    ```
 * Configure the registry back
   ```sh
   pnpm config set registry https://registry.npmjs.org/
   pnpm config get registry
   ```

