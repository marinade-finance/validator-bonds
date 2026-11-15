#!/usr/bin/env python3
"""Downloads the deployed mainnet validator-bonds and stake program ELFs into ./bin."""
import base64, hashlib, json, os, urllib.request

RPC = os.environ.get("RPC_URL", "https://api.mainnet-beta.solana.com")
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
PROGRAMS = {
    "mainnet_bonds.so": "vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4",
    "mainnet_stake.so": "Stake11111111111111111111111111111111111111",
}


def b58(raw):
    number, text = int.from_bytes(raw, "big"), ""
    while number:
        number, rem = divmod(number, 58)
        text = B58[rem] + text
    return text


def account_data(address):
    body = {"jsonrpc": "2.0", "id": 1, "method": "getAccountInfo", "params": [address, {"encoding": "base64"}]}
    request = urllib.request.Request(RPC, json.dumps(body).encode(), {"Content-Type": "application/json"})
    return base64.b64decode(json.load(urllib.request.urlopen(request, timeout=120))["result"]["value"]["data"][0])


def elf_bytes(padded):
    """Cuts the program-data padding: an ELF ends with its section header table."""
    section_offset = int.from_bytes(padded[40:48], "little")
    entry_size = int.from_bytes(padded[58:60], "little")
    entry_count = int.from_bytes(padded[60:62], "little")
    return padded[: section_offset + entry_size * entry_count]


os.makedirs("bin", exist_ok=True)
for name, program in PROGRAMS.items():
    program_data = b58(account_data(program)[4:36])
    elf = elf_bytes(account_data(program_data)[45:])
    with open(os.path.join("bin", name), "wb") as out:
        out.write(elf)
    print(name, len(elf), hashlib.sha256(elf).hexdigest())
