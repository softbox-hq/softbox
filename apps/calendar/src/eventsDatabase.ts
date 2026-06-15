import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

export type EventCategory = 'Work' | 'Personal' | 'Health'

export type CalendarEvent = {
  id: number
  title: string
  date: string
  time: string
  category: EventCategory
}

export type EventsDatabase = {
  listEvents: () => CalendarEvent[]
  addEvent: (event: Omit<CalendarEvent, 'id'>) => CalendarEvent
  close: () => void
}

const storageKey = 'softbox-calendar-events-db'

export async function openEventsDatabase(seedEvents: CalendarEvent[]): Promise<EventsDatabase> {
  const SQL = await initSqlJs({
    locateFile: () => wasmUrl,
  })

  const savedDatabase = readSavedDatabase()
  const database = savedDatabase ? new SQL.Database(savedDatabase) : new SQL.Database()

  database.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('Work', 'Personal', 'Health'))
    );
  `)

  const count = database.exec('SELECT COUNT(*) AS total FROM events;')[0]?.values[0]?.[0]
  if (count === 0) {
    const insertSeed = database.prepare(`
      INSERT INTO events (id, title, date, time, category)
      VALUES (:id, :title, :date, :time, :category);
    `)

    try {
      seedEvents.forEach((event) => {
        insertSeed.run({
          ':id': event.id,
          ':title': event.title,
          ':date': event.date,
          ':time': event.time,
          ':category': event.category,
        })
      })
    } finally {
      insertSeed.free()
    }
  }

  persistDatabase(database)

  return {
    listEvents: () => listEvents(database),
    addEvent: (event: Omit<CalendarEvent, 'id'>) => addEvent(database, event),
    close: () => database.close(),
  }
}

function listEvents(database: Database): CalendarEvent[] {
  const result = database.exec(`
    SELECT id, title, date, time, category
    FROM events
    ORDER BY date ASC, time ASC, id ASC;
  `)[0]

  if (!result) {
    return []
  }

  return result.values.map(([id, title, date, time, category]) => ({
    id: Number(id),
    title: String(title),
    date: String(date),
    time: String(time),
    category: toEventCategory(category),
  }))
}

function addEvent(database: Database, event: Omit<CalendarEvent, 'id'>): CalendarEvent {
  database.run(
    `
      INSERT INTO events (title, date, time, category)
      VALUES (:title, :date, :time, :category);
    `,
    {
      ':title': event.title,
      ':date': event.date,
      ':time': event.time,
      ':category': event.category,
    },
  )

  const id = database.exec('SELECT last_insert_rowid();')[0]?.values[0]?.[0]
  persistDatabase(database)

  return {
    id: Number(id),
    ...event,
  }
}

function readSavedDatabase() {
  const saved = window.localStorage.getItem(storageKey)
  if (!saved) {
    return null
  }

  const binary = window.atob(saved)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function persistDatabase(database: Database) {
  const bytes = database.export()
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  window.localStorage.setItem(storageKey, window.btoa(binary))
}

function toEventCategory(value: unknown): EventCategory {
  if (value === 'Personal' || value === 'Health') {
    return value
  }

  return 'Work'
}
