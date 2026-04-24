import sqlite3

db_url = ".deer-flow/users.db"
conn = sqlite3.connect(db_url)
cursor = conn.cursor()
cursor.execute("""CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT,
    hashed_password TEXT,
    disabled INTEGER DEFAULT 0
)""")
conn.commit()
conn.close()
print("数据库初始化完成")
