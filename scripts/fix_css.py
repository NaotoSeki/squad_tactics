import os

# Read the beautiful original HTML
with open('original_preview.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Make CSS dynamic
html = html.replace('width: 256px;', 'width: {frame_w}px;')
html = html.replace('height: 179px;', 'height: {frame_h}px;')

# Make JS dynamic
html = html.replace('const FRAME_WIDTH = 256;', 'const FRAME_WIDTH = {frame_w};')
html = html.replace('const FRAME_HEIGHT = 179;', 'const FRAME_HEIGHT = {frame_h};')

# Make options dynamic
start_marker = '<select id="action-select">'
end_marker = '</select>'
start_idx = html.find(start_marker)
end_idx = html.find(end_marker, start_idx)

if start_idx != -1 and end_idx != -1:
    before = html[:start_idx + len(start_marker)]
    after = html[end_idx:]
    html = before + '\n{options_html}\n' + after

# Escape brackets for f-string, except for the dynamic variables
html_template = 'f"""' + html.replace('{', '{{').replace('}', '}}').replace('{{frame_w}}', '{frame_w}').replace('{{frame_h}}', '{frame_h}').replace('{{options_html}}', '{options_html}') + '"""'

# Inject into create_spritesheet.py
with open('c:/Projects/squad_tactics/scripts/create_spritesheet.py', 'r', encoding='utf-8') as f:
    py_code = f.read()

start_py = py_code.find('html_content = f"""<!DOCTYPE html>')
if start_py != -1:
    new_tail = f'''options_html = "\\n".join([f'<option value="{{a}}">{{a}}</option>' for a in actions_filtered.keys()])
    html_content = {html_template}
    with open(os.path.join(OUTPUT_DIR, "preview.html"), "w", encoding="utf-8") as f:
        f.write(html_content)
    print("Generated dynamic preview.html")

if __name__ == "__main__":
    create_spritesheets()'''
    
    py_code = py_code[:start_py] + new_tail

with open('c:/Projects/squad_tactics/scripts/create_spritesheet.py', 'w', encoding='utf-8') as f:
    f.write(py_code)

print("Fixed CSS template injection!")
