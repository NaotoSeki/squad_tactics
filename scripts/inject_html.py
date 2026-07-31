import os

with open('original_preview.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = html.replace('const FRAME_WIDTH = 256;', 'const FRAME_WIDTH = {frame_w};')
html = html.replace('const FRAME_HEIGHT = 179;', 'const FRAME_HEIGHT = {frame_h};')

# We need to replace the <select id="action-select"> options block with dynamic one
start_marker = '<select id="action-select">'
end_marker = '</select>'
start_idx = html.find(start_marker)
end_idx = html.find(end_marker, start_idx)

if start_idx != -1 and end_idx != -1:
    before = html[:start_idx + len(start_marker)]
    after = html[end_idx:]
    html = before + '\n{options_html}\n' + after

html_template = 'f"""' + html.replace('{', '{{').replace('}', '}}').replace('{{frame_w}}', '{frame_w}').replace('{{frame_h}}', '{frame_h}').replace('{{options_html}}', '{options_html}') + '"""'

with open('c:/Projects/squad_tactics/scripts/create_spritesheet_test.py', 'r', encoding='utf-8') as f:
    py_code = f.read()

# Replace the html_content generation part
start_py = py_code.find('html_content = f"""<!DOCTYPE html>')
if start_py != -1:
    py_code = py_code[:start_py] + f'''options_html = "\\n".join([f\'<option value="{{a}}">{{a}}</option>\' for a in actions_filtered.keys()])\n    html_content = {html_template}\n    with open(os.path.join(OUTPUT_DIR, "preview.html"), "w", encoding="utf-8") as f:\n        f.write(html_content)\n    print("Generated dynamic preview.html")\n\nif __name__ == "__main__":\n    create_spritesheets()'''

with open('c:/Projects/squad_tactics/scripts/create_spritesheet_test.py', 'w', encoding='utf-8') as f:
    f.write(py_code)

print("Injected template.")
