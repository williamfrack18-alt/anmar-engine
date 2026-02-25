
import sqlite3

def create_tickets_table():
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    
    try:
        # Create Tickets Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_name TEXT NOT NULL,
                user_email TEXT NOT NULL,
                request TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                ai_suggestion TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_email) REFERENCES users(email)
            )
        ''')
        print("✅ Tabla 'tickets' creada exitosamente.")
        
    except sqlite3.OperationalError as e:
        print(f"⚠️ Error: {e}")
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    create_tickets_table()
