import { useMemo, useState } from 'react'
import aliceText from '../assets/alice-in-wonderland.txt?raw'
import frankensteinText from '../assets/frankenstein.txt?raw'
import mobyDickText from '../assets/mobydick.txt?raw'
import './App.css'

type Book = {
  id: string
  title: string
  author: string
  content: string
}

const books: Book[] = [
  {
    id: 'alice-in-wonderland',
    title: 'Alice in Wonderland',
    author: 'Lewis Carroll',
    content: aliceText,
  },
  {
    id: 'frankenstein',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    content: frankensteinText,
  },
  {
    id: 'mobydick',
    title: 'Moby-Dick',
    author: 'Herman Melville',
    content: mobyDickText,
  },
]

function App() {
  const [selectedId, setSelectedId] = useState(books[0].id)

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedId) ?? books[0],
    [selectedId],
  )

  return (
    <main className="books-app">
      <aside className="books-sidebar">
        <div className="books-sidebar__header">
          <p className="books-sidebar__eyebrow">Library</p>
          <h1>Books</h1>
        </div>

        <nav className="books-list" aria-label="Book selection">
          {books.map((book) => {
            const isActive = book.id === selectedBook.id
            return (
              <button
                key={book.id}
                type="button"
                className={`books-list__item ${isActive ? 'is-active' : ''}`}
                onClick={() => setSelectedId(book.id)}
              >
                <span className="books-list__title">{book.title}</span>
                <span className="books-list__author">{book.author}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <section className="reader-pane" aria-label="Reading pane">
        <header className="reader-pane__header">
          <div>
            <p className="reader-pane__eyebrow">Now reading</p>
            <h2>{selectedBook.title}</h2>
            <p className="reader-pane__author">{selectedBook.author}</p>
          </div>
        </header>

        <div className="reader-pane__content">
          <pre className="reader-text">{selectedBook.content}</pre>
        </div>
      </section>
    </main>
  )
}

export default App
