import { useRef, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const FIVE_GB = 5 * 1024 * 1024 * 1024;
const TEN_GB = 10 * 1024 * 1024 * 1024;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function DownloadIcon() {
  return (
    <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 2v5h5M8.5 13h7M8.5 17h7M8.5 9h2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [status, setStatus] = useState('Choose a Parquet file to begin.');
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadName, setDownloadName] = useState('output.csv');
  const fileInputRef = useRef(null);
  const downloadLinkRef = useRef(null);

  const chooseFile = (file) => {
    setError('');
    setDownloadUrl('');

    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.parquet')) {
      setSelectedFile(null);
      setStatus('Choose a Parquet file to begin.');
      setError('That file type is not supported. Please choose a .parquet file.');
      return;
    }

    if (file.size > TEN_GB) {
      setSelectedFile(null);
      setStatus('Choose a Parquet file to begin.');
      setError('This file is larger than 10GB. Please choose a smaller Parquet file.');
      return;
    }

    setSelectedFile(file);
    setStatus('Ready to convert.');

    if (file.size > FIVE_GB) {
      setStatus('Ready to convert. Large files over 5GB may take several minutes.');
    }
  };

  const handleInputChange = (event) => {
    chooseFile(event.target.files?.[0]);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const reset = () => {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }

    setSelectedFile(null);
    setIsDragging(false);
    setIsConverting(false);
    setStatus('Choose a Parquet file to begin.');
    setError('');
    setDownloadUrl('');
    setDownloadName('output.csv');

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const convertFile = async () => {
    if (!selectedFile) return;

    setIsConverting(true);
    setError('');
    setDownloadUrl('');
    setStatus('Uploading and converting your file...');

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch(`${API_URL}/convert`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let message = 'Conversion failed. Please try again.';
        try {
          const data = await response.json();
          message = data.detail || message;
        } catch {
          message = response.statusText || message;
        }
        throw new Error(message);
      }

      setStatus('Preparing your CSV download...');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const csvName = selectedFile.name.replace(/\.parquet$/i, '.csv') || 'output.csv';

      setDownloadUrl(url);
      setDownloadName(csvName);
      setStatus('Conversion complete. Your download should start automatically.');

      window.setTimeout(() => {
        if (downloadLinkRef.current) {
          downloadLinkRef.current.click();
        }
      }, 0);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Network error. Please check the backend URL and try again.';
      setError(message);
      setStatus('Conversion stopped.');
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8 lg:px-10">
        <header className="py-8 text-center sm:py-12">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">
            DuckDB streaming conversion
          </p>
          <h1 className="mt-4 text-4xl font-extrabold tracking-normal text-white sm:text-6xl">
            Parquet &rarr; CSV Converter
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            Upload a Parquet file and convert it to CSV from your browser. Built for very large
            datasets without loading the full file into memory.
          </p>
        </header>

        <section className="grid flex-1 gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-black/30 sm:p-6">
            <button
              type="button"
              className={`flex min-h-[280px] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
                isDragging
                  ? 'border-cyan-300 bg-cyan-300/10 text-cyan-100'
                  : 'border-slate-600 bg-slate-950/50 text-slate-300 hover:border-cyan-400 hover:bg-slate-900'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              disabled={isConverting}
            >
              <span className="rounded-full bg-cyan-400/10 p-4 text-cyan-300">
                <DownloadIcon />
              </span>
              <span className="mt-6 text-xl font-bold text-white">
                {selectedFile ? selectedFile.name : 'Drop your .parquet file here'}
              </span>
              <span className="mt-3 max-w-md text-sm leading-6 text-slate-400">
                Click to browse or drag a file onto this area. Files up to 10GB are accepted.
              </span>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept=".parquet"
                onChange={handleInputChange}
              />
            </button>

            <div className="mt-5">
              <button
                type="button"
                onClick={convertFile}
                disabled={!selectedFile || isConverting}
                className="flex h-12 w-full items-center justify-center rounded-lg bg-cyan-400 px-5 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {isConverting ? (
                  <>
                    <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                    Converting...
                  </>
                ) : (
                  'Convert to CSV'
                )}
              </button>
            </div>
          </div>

          <aside className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-black/30 sm:p-6">
            <h2 className="text-lg font-bold text-white">File details</h2>

            {selectedFile ? (
              <div className="mt-5 space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                  <span className="mt-0.5 text-cyan-300">
                    <FileIcon />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-white">{selectedFile.name}</p>
                    <p className="mt-1 text-sm text-slate-400">{formatBytes(selectedFile.size)}</p>
                  </div>
                </div>

                {selectedFile.size > FIVE_GB && (
                  <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                    This file is over 5GB, so upload and conversion may take several minutes.
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm leading-6 text-slate-400">
                No file selected yet.
              </p>
            )}

            <div className="mt-6">
              <h2 className="text-lg font-bold text-white">Status</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">{status}</p>

              {isConverting && (
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full w-1/2 animate-progress rounded-full bg-cyan-300" />
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                  {error}
                </div>
              )}

              {downloadUrl && (
                <div className="mt-5 space-y-3">
                  <a
                    ref={downloadLinkRef}
                    href={downloadUrl}
                    download={downloadName}
                    className="flex h-11 items-center justify-center rounded-lg border border-cyan-300 px-4 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300 hover:text-slate-950"
                  >
                    Download CSV
                  </a>
                  <button
                    type="button"
                    onClick={reset}
                    className="flex h-11 w-full items-center justify-center rounded-lg border border-slate-700 px-4 text-sm font-bold text-slate-100 transition hover:border-slate-400 hover:bg-slate-800"
                  >
                    Convert another file
                  </button>
                </div>
              )}
            </div>
          </aside>
        </section>

        <footer className="py-8 text-center text-sm text-slate-500">
          Free tool. Handles 200M+ rows. Powered by DuckDB.
        </footer>
      </div>
    </main>
  );
}
