import os
import json
import re
from pathlib import Path

def parse_sdt(content):
    # This is a very rudimentary parser for the .sdt format.
    # Replace newlines and tabs with spaces
    content = re.sub(r'//.*?\n', '\n', content) # remove comments
    content = content.replace('\n', ' ').replace('\t', ' ').replace('\r', ' ')
    
    # Add quotes around unquoted keys/values
    # Note: parsing SDT properly requires a state machine since it looks like:
    # template weapon.mg_turret [ turret: true shot [ animations [ dynamic [ animation [ id: mg_shot layer: turret ] ] ] ] ]
    
    tokens = re.findall(r'[\[\]:]|[a-zA-Z0-9_\.\-]+|<[^>]+>|,', content)
    
    result = {}
    stack = [result]
    current_key = None
    
    i = 0
    while i < len(tokens):
        token = tokens[i]
        
        if token == '[':
            new_dict = {}
            if current_key:
                stack[-1][current_key] = new_dict
                stack.append(new_dict)
                current_key = None
            else:
                # Array-like or anonymous block
                if isinstance(stack[-1], list):
                    stack[-1].append(new_dict)
                    stack.append(new_dict)
                else:
                    if 'items' not in stack[-1]:
                        stack[-1]['items'] = []
                    stack[-1]['items'].append(new_dict)
                    stack.append(new_dict)
        elif token == ']':
            if len(stack) > 1:
                stack.pop()
        elif token == ':':
            pass
        elif token == ',':
            pass
        elif token.startswith('<') and token.endswith('>'):
            if current_key:
                stack[-1][current_key + "_extends"] = token[1:-1]
        else:
            if i + 1 < len(tokens) and (tokens[i+1] == ':' or tokens[i+1] == '[' or (tokens[i+1].startswith('<') and tokens[i+1].endswith('>'))):
                current_key = token
            elif current_key:
                if current_key in stack[-1]:
                    if not isinstance(stack[-1][current_key], list):
                        stack[-1][current_key] = [stack[-1][current_key]]
                    stack[-1][current_key].append(token)
                else:
                    stack[-1][current_key] = token
                current_key = None
            else:
                if 'values' not in stack[-1]:
                    stack[-1]['values'] = []
                stack[-1]['values'].append(token)
                
        i += 1
        
    return result

def extract_all():
    base_dir = r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Configs"
    out_dir = r"c:\Projects\squad_tactics\scratch"
    os.makedirs(out_dir, exist_ok=True)
    
    db = {}
    
    for root, _, files in os.walk(base_dir):
        for f in files:
            if f.endswith('.sdt'):
                path = os.path.join(root, f)
                with open(path, 'r', encoding='utf-8', errors='ignore') as fp:
                    content = fp.read()
                parsed = parse_sdt(content)
                
                rel = os.path.relpath(path, base_dir)
                db[rel] = parsed
                
    with open(os.path.join(out_dir, 'ps_database.json'), 'w', encoding='utf-8') as fp:
        json.dump(db, fp, indent=2)
        
    print(f"Extracted {len(db)} files to ps_database.json")

if __name__ == "__main__":
    extract_all()
