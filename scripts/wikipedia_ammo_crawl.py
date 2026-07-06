# -*- coding: utf-8 -*-
"""
【非推奨 2026-05-31】Wikipedia 口径ヒューリスティクス — 誤提案の原因。実行しない。

正本: python scripts/export_pl_cbe_ammo_truth.py
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH_JSON = ROOT / "data" / "pl_ammo_historical_research.json"
AUDIT_JSON = ROOT / "data" / "pl_ammo_comprehensive_audit.json"
NAMES_JSON = ROOT / "data" / "cbe_name_table.json"

# 口径キーワード → PL index 候補（ヒューリスティック — 要人手確認）
CALIBER_HINTS: list[tuple[str, list[int]]] = [
    (r"7\.92\s*[×x]\s*33|7\.9mm\s*Kurz|Kurzpatrone|Pistolenpatrone\s*M43", [278, 277]),
    (r"7\.92\s*[×x]\s*57|7\.92mm|8mm\s*Mauser|7\.9mm(?!\s*Kurz)", [272, 273, 274]),
    (r"\.303\s*British|\.303\s*Br", [355, 357, 358]),
    (r"\.30-06|30-06|3006", [229, 230, 231, 238, 239, 240]),
    (r"\.50\s*BMG|12\.7", [241]),
    (r"\.45\s*ACP|11\.43", [225, 226, 234, 235, 236, 237]),
    (r"9\s*[×x]\s*19|9mm\s*Parabellum|9mm\s*Luger", [258, 320, 278]),
    (r"7\.65\s*[×x]\s*21|\.30\s*Luger|32\s*ACP", [259, 265]),
    (r"\.30\s*carbine|30\s*Carbine", [232, 233]),
]


def fetch_wikipedia_summary(title: str) -> tuple[str, str]:
    """MediaWiki API — 先頭 extract + page url。"""
    params = {
        "action": "query",
        "format": "json",
        "prop": "extracts|info",
        "exintro": "1",
        "explaintext": "1",
        "titles": title,
        "inprop": "url",
    }
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "SquadTactics-AmmoResearch/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    pages = data.get("query", {}).get("pages", {})
    page = next(iter(pages.values()), {})
    extract = page.get("extract") or ""
    page_url = page.get("fullurl") or f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
    return extract, page_url


def extract_cartridge_line(text: str) -> str:
    for line in text.split("\n"):
        if re.search(r"cartridge|calibre|caliber|ammunition", line, re.I):
            return line.strip()
    m = re.search(
        r"(?:Cartridge|Calibre|Caliber|Ammunition)[:\s]+([^\n|]+)",
        text,
        re.I,
    )
    return m.group(1).strip() if m else ""


def guess_pl_indices(cartridge_text: str) -> list[int]:
    if not cartridge_text:
        return []
    out: list[int] = []
    for pat, indices in CALIBER_HINTS:
        if re.search(pat, cartridge_text, re.I):
            for i in indices:
                if i not in out:
                    out.append(i)
    return out


def load_research() -> dict:
    if not RESEARCH_JSON.exists():
        return {"_meta": {"updated": date.today().isoformat()}, "weapons": {}}
    doc = json.loads(RESEARCH_JSON.read_text(encoding="utf-8"))
    if "weapons" not in doc:
        doc = {"_meta": {}, "weapons": doc}
    return doc


def save_research(doc: dict) -> None:
    doc["_meta"]["updated"] = date.today().isoformat()
    RESEARCH_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def wiki_title_for_weapon(name: str) -> str:
    """武器名 → Wikipedia タイトル推定。"""
    overrides = {
        "P08": "Luger pistol",
        "Kar98k": "Karabiner 98k",
        "Kar98k svw": "Karabiner 98k",
        "No3 Mk1*(T)": "Lee–Enfield",
        "No4 Mk1*": "Lee–Enfield",
        "MKb42(W)": "StG 44",
        "MP43": "StG 44",
        "StG44": "StG 44",
        "VG1-5": "Volkssturmgewehr",
        "M1 SMG": "Thompson submachine gun",
        "M1A1 SMG": "Thompson submachine gun",
        "M1928A1 SMG": "Thompson submachine gun",
        "Bren Mk2": "Bren light machine gun",
        "Bren Mk1": "Bren light machine gun",
        "Bren Mk3": "Bren light machine gun",
        "Lewis Mk1": "Lewis gun",
        "Vickers Mk1": "Vickers machine gun",
        "M1919A6 LMG": "M1919 Browning machine gun",
        "M1919A4 MMG": "M1919 Browning machine gun",
        "M1917A1 MMG": "M1919 Browning machine gun",
        "M2 HB HMG": "M2 Browning",
        "FG42/1": "FG 42",
        "FG42/2": "FG 42",
        "Kar43": "Gewehr 43",
        "Zf Kar98k": "Karabiner 98k",
        "Gew43": "Gewehr 43",
        "C/96M712": "Mauser C96",
    }
    if name in overrides:
        return overrides[name]
    return name


def crawl_weapon(wi: int, name: str, title: str | None = None) -> dict:
    wt = title or wiki_title_for_weapon(name)
    extract, url = fetch_wikipedia_summary(wt)
    cart = extract_cartridge_line(extract)
    indices = guess_pl_indices(cart + " " + extract[:800])
    summary = cart or extract[:200].replace("\n", " ")
    return {
        "historicalPlIndices": indices,
        "summary": f"{name}: {summary}",
        "sources": [url],
        "notes": f"Auto-crawl {date.today().isoformat()}. Indices は口径ヒューリスティクス — 人手確認。",
        "wikipediaTitle": wt,
        "cartridgeLine": cart,
    }


def queue_unresearched(limit: int = 50) -> list[tuple[int, str]]:
    if not AUDIT_JSON.exists():
        return []
    audit = json.loads(AUDIT_JSON.read_text(encoding="utf-8"))
    doc = load_research()
    done = set(int(k) for k in doc.get("weapons", {}).keys())
    out: list[tuple[int, str]] = []
    for w in audit.get("weapons") or []:
        wi = w["cbeIdx"]
        if wi in done:
            continue
        out.append((wi, w["name"]))
        if len(out) >= limit:
            break
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="非推奨 — 凍結ファイルへ追記")
    parser.add_argument("--weapon", nargs=3, metavar=("IDX", "NAME", "WIKI_TITLE"))
    parser.add_argument("--batch", type=int, default=0, help="未調査キューから N 件 crawl")
    args = parser.parse_args()

    if not args.force:
        print("DEPRECATED: wikipedia_ammo_crawl.py は非推奨（誤提案の原因）。")
        print("  正本: python scripts/export_pl_cbe_ammo_truth.py")
        sys.exit(1)

    doc = load_research()
    weapons = doc.setdefault("weapons", {})

    if args.weapon:
        wi, name, title = int(args.weapon[0]), args.weapon[1], args.weapon[2]
        weapons[str(wi)] = crawl_weapon(wi, name, title)
        save_research(doc)
        print(f"Crawled {wi} {name}")
        return

    if args.batch > 0:
        queue = queue_unresearched(args.batch)
        for wi, name in queue:
            try:
                weapons[str(wi)] = crawl_weapon(wi, name)
                print(f"  OK {wi} {name}")
                time.sleep(1.2)
            except Exception as e:
                print(f"  FAIL {wi} {name}: {e}", file=sys.stderr)
                time.sleep(3.0)
        save_research(doc)
        print(f"Saved {len(queue)} entries to {RESEARCH_JSON}")
        return

    print("Usage: --batch N  or  --weapon IDX NAME WIKI_TITLE")


if __name__ == "__main__":
    main()
