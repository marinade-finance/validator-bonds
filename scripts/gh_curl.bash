#!/bin/bash

GH_CURL_COMMAND='curl -L -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28"'
GH_BEARER_TOKEN_HEADER='-H "Authorization: Bearer $GH_BEARER_TOKEN"'

if [[ -n $GH_BEARER_TOKEN ]]; then
    GH_CURL_COMMAND="$GH_CURL_COMMAND $(eval $GH_BEARER_TOKEN_HEADER)s"
fi

endpoint="$1"
    
eval "$GH_CURL_COMMAND $endpoint"
