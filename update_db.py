
import sqlite3

def add_tokens_column():
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN tokens INTEGER DEFAULT 3")
        print("✅ Columna 'tokens' añadida exitosamente.")
    except sqlite3.OperationalError as e:
        print(f"⚠️ Nota: {e}")
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    add_tokens_column()
