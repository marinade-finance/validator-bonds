#!/bin/bash

set -eo pipefail

if [[ -z $GEMINI_API_KEY ]]; then
  echo "GEMINI_API_KEY is not set. Exiting."
  exit 1
fi

function file_to_prompt() {
    local file_path="$1"
    local mime_type="$2"
    jq -n --arg mime_type "$mime_type" --rawfile b64_logs <(base64 < "$file_path" | tr -d '\n') '{inline_data: { mime_type: $mime_type, data: $b64_logs } }'
}

function text_to_prompt() {
    local text="$1"
    jq -n --arg text "$text" '{ text: $text }'
}

PROMPT=$(cat)


PERSONALITY=$(cat <<EOF
You are an expert assistant.

Your audience is a group of expert software engineers.

Your responses will be:
    - concise
    - precise
    - simple

If unsure, say so. Do not hallucinate or make up answers. Giving wrong information is worse than saying "I don't know".

Use emoticons only at the beginning of the line and only when color/images provide clarity (✅/❌/⚠️/...).

Do not use overly-friendly or casual language.

Lead with one-liner decisive answer, then back it up with reasoning if needed.
EOF
)

PAYLOAD_GENERATION_CONFIG=$(jq -n '{
  responseMimeType: "application/json",
  responseSchema: {
    type: "OBJECT",
    properties: {
      level: {
        type: "STRING",
        description: "The severity level describing the summary. Can be info, warning, or error. This field can be used to determine the importance of the message.",
        enum: ["info", "warning", "error"]
      },
      response: {
        type: "STRING",
        description: "Response to the user."
      }
    },
    propertyOrdering: ["level", "response"],
    required: ["level", "response"]
  }
}')

if [[ -z "$1" ]]; then
  echo "No file provided Proceeding with prompt only."
  PAYLOAD=$(jq -n \
      --slurpfile prompt <(text_to_prompt "$PROMPT") \
      --slurpfile generation_config <(<<<"$PAYLOAD_GENERATION_CONFIG" cat) \
      --slurpfile personality <(text_to_prompt "$PERSONALITY") \
      '{ contents: [ { parts: [ $prompt[0] ] } ], systemInstruction: { parts: [ $personality[0] ] }, generationConfig: $generation_config[0] }'
  )
elif ! [[ -f "$1" ]]; then
  echo "File $1 does not exist."
  exit 1
else
  FILE="$1"
  PAYLOAD=$(jq -n \
      --slurpfile prompt <(text_to_prompt "$PROMPT") \
      --slurpfile log <(file_to_prompt "$FILE" "text/plain") \
      --slurpfile generation_config <(<<<"$PAYLOAD_GENERATION_CONFIG" cat) \
      --slurpfile personality <(text_to_prompt "$PERSONALITY") \
      '{ contents: [ { parts: [ $prompt[0], $log[0] ] } ], systemInstruction: { parts: [ $personality[0] ] }, generationConfig: $generation_config[0] }'
  )
fi


# <<<"$PAYLOAD" jq .
GEMINI_DEBUG_OUTPUT="gemini-debug-output.json"
GEMINI_DEBUG_INPUT="gemini-debug-input.json"

HTTP_CODE=$(<<<"$PAYLOAD" tee "$GEMINI_DEBUG_INPUT" | curl -sLS \
    -o "$GEMINI_DEBUG_OUTPUT" -w '%{http_code}' \
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -H 'Content-Type: application/json' \
    -X POST \
    --data-binary @-)

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Gemini API returned HTTP $HTTP_CODE:" >&2
  cat "$GEMINI_DEBUG_OUTPUT" >&2
  exit 1
fi

jq '.candidates[].content.parts[].text' -r < "$GEMINI_DEBUG_OUTPUT" | jq .

exit 0
