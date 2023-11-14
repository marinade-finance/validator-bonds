#!/bin/bash#!/bin/bash

gstorage_items=$(gcloud storage ls --recursive gs://jito-mainnet || exit 1)
