# チャット履歴を残すには

Cursor では **「フォルダを開く」** と **「ワークスペースファイル（.code-workspace）を開く」** は**別のワークスペース**として扱われ、チャット履歴も別々です。

- **フォルダだけを開く**（File → Open Folder → `squad_tactics`）  
  → 別ワークスペースになり、いつものチャット履歴は出ません。
- **ワークスペースで開く**（File → Open Workspace from File → `workspace.code-workspace`）  
  → いつものチャット履歴が表示されます。

## おすすめの開き方

1. **`open_workspace.cmd` をダブルクリック**  
   → Cursor が `workspace.code-workspace` で開き、同じチャット履歴が使えます。

2. または Cursor 起動後、**File → Open Workspace from File** で  
   `C:\Projects\squad_tactics\workspace.code-workspace` を選ぶ。

どちらも「同じワークスペース」になるので、履歴は残ります。
