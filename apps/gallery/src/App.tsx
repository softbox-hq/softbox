import { useState } from 'react'
import dogImage from './assets/dog.png'
import catImage from './assets/cat.png'
import openclawBotImage from './assets/openclaw-bot.png'
import './App.css'

function App() {
  const [selectedImage, setSelectedImage] = useState<{
    src: string
    alt: string
  } | null>(null)

  return (
    <div className="photos-app" aria-label="Apple Photos style gallery">
      <header className="topbar">
        <div className="traffic-lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="topbar-title">
          <span className="app-name">Photos</span>
          <span className="app-subtitle">Library</span>
        </div>

        <div className="topbar-actions" aria-hidden="true">
          <button type="button">+</button>
          <button type="button">◦◦◦</button>
        </div>
      </header>

      <div className="photos-shell">
        <aside className="sidebar" aria-label="Navigation">
          <div className="sidebar-section">
            <div className="sidebar-label">Library</div>
            <button className="sidebar-item active" type="button">
              <span className="sidebar-icon">▣</span>
              All Photos
            </button>
            <button className="sidebar-item" type="button">
              <span className="sidebar-icon">▢</span>
              Days
            </button>
            <button className="sidebar-item" type="button">
              <span className="sidebar-icon">◫</span>
              Albums
            </button>
          </div>
        </aside>

        <main className="content" aria-label="Gallery grid">
          <div className="toolbar">
            <div className="toolbar-pill active">All Photos</div>
            <div className="toolbar-pill">Years</div>
            <div className="toolbar-pill">Months</div>
            <div className="toolbar-pill">Days</div>
          </div>

          <div className="gallery-grid">
            {[
              { src: dogImage, alt: 'Dog portrait' },
              { src: catImage, alt: 'Cat portrait' },
              { src: openclawBotImage, alt: 'OpenClaw bot' },
            ].map((image) => (
              <button
                key={image.alt}
                type="button"
                className="gallery-card"
                onClick={() => setSelectedImage(image)}
              >
                <img
                  src={image.src}
                  className="gallery-item"
                  width="170"
                  height="179"
                  alt={image.alt}
                />
              </button>
            ))}
          </div>
        </main>
      </div>

      {selectedImage ? (
        <button
          type="button"
          className="lightbox"
          aria-label="Close enlarged photo"
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage.src}
            className="lightbox-image"
            alt={selectedImage.alt}
          />
        </button>
      ) : null}
    </div>
  )
}

export default App
