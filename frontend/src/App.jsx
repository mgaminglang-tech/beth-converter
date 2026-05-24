import { useRef, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';
const FIVE_GB = 10 * 1024 * 1024 * 1024;
const TEN_GB = 20 * 1024 * 1024 * 1024;

const FILTER_OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts With' },
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'less_than', label: 'Less Than' },
  { value: 'is_empty', label: 'Is Empty' },
  { value: 'is_not_empty', label: 'Is Not Empty' },
];

const VALUELESS_OPERATORS = new Set(['is_empty', 'is_not_empty']);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatNumber(value) {
  if (!Number.isFinite(Number(value))) return '0';
  return Number(value).toLocaleString();
}

function previewValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
  const [activeTab, setActiveTab] = useState('convert');

  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [status, setStatus] = useState('Choose a Parquet file to begin.');
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadName, setDownloadName] = useState('output.csv');
  const fileInputRef = useRef(null);
  const downloadLinkRef = useRef(null);

  const [searchFile, setSearchFile] = useState(null);
  const [isSearchDragging, setIsSearchDragging] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isDownloadingSearch, setIsDownloadingSearch] = useState(false);
  const [searchStatus, setSearchStatus] = useState('Choose a Parquet or .zst file to begin.');
  const [searchError, setSearchError] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [filters, setFilters] = useState([]);
  const [rowLimit, setRowLimit] = useState('0');
  const [searchDownloadUrl, setSearchDownloadUrl] = useState('');
  const searchFileInputRef = useRef(null);
  const searchDownloadLinkRef = useRef(null);

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
      setError('This file is larger than 20GB. Please choose a smaller Parquet file.');
      return;
    }

    setSelectedFile(file);
    setStatus('Ready to convert.');

    if (file.size > FIVE_GB) {
      setStatus('Ready to convert. Large files over 10GB may take several minutes.');
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

  const chooseSearchFile = (file) => {
    setSearchError('');
    setSearchDownloadUrl('');

    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.parquet') && !lowerName.endsWith('.zst')) {
      setSearchFile(null);
      setPreviewData(null);
      setFilters([]);
      setSearchStatus('Choose a Parquet or .zst file to begin.');
      setSearchError('That file type is not supported. Please choose a .parquet or .zst file.');
      return;
    }

    if (file.size > TEN_GB) {
      setSearchFile(null);
      setPreviewData(null);
      setFilters([]);
      setSearchStatus('Choose a Parquet or .zst file to begin.');
      setSearchError('This file is larger than 20GB. Please choose a smaller file.');
      return;
    }

    setSearchFile(file);
    setPreviewData(null);
    setFilters([]);
    setSearchStatus('Ready to load preview.');

    if (file.size > FIVE_GB) {
      setSearchStatus('Ready to load preview. Large files over 10GB may take several minutes.');
    }
  };

  const handleSearchInputChange = (event) => {
    chooseSearchFile(event.target.files?.[0]);
  };

  const handleSearchDrop = (event) => {
    event.preventDefault();
    setIsSearchDragging(false);
    chooseSearchFile(event.dataTransfer.files?.[0]);
  };

  const handleSearchDragOver = (event) => {
    event.preventDefault();
    setIsSearchDragging(true);
  };

  const handleSearchDragLeave = (event) => {
    event.preventDefault();
    setIsSearchDragging(false);
  };

  const loadPreview = async () => {
    if (!searchFile) return;

    setIsLoadingPreview(true);
    setSearchError('');
    setSearchDownloadUrl('');
    setSearchStatus('Loading preview...');

    const formData = new FormData();
    formData.append('file', searchFile);

    try {
      const response = await fetch('/preview', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let message = 'Preview failed. Please try again.';
        try {
          const data = await response.json();
          message = data.detail || message;
        } catch {
          message = response.statusText || message;
        }
        throw new Error(message);
      }

      const data = await response.json();
      setPreviewData(data);
      setFilters([]);
      setSearchStatus(`${formatNumber(data.total_rows)} rows found.`);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Network error. Please check the backend and try again.';
      setSearchError(message);
      setSearchStatus('Preview stopped.');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const addFilter = () => {
    const firstColumn = previewData?.columns?.[0] || '';
    setFilters((currentFilters) => [
      ...currentFilters,
      { column: firstColumn, operator: 'equals', value: '' },
    ]);
  };

  const updateFilter = (index, field, value) => {
    setFilters((currentFilters) =>
      currentFilters.map((filter, filterIndex) => {
        if (filterIndex !== index) return filter;
        const nextFilter = { ...filter, [field]: value };
        if (field === 'operator' && VALUELESS_OPERATORS.has(value)) {
          nextFilter.value = '';
        }
        return nextFilter;
      }),
    );
  };

  const removeFilter = (index) => {
    setFilters((currentFilters) => currentFilters.filter((_, filterIndex) => filterIndex !== index));
  };

  const clearFilters = () => {
    setFilters([]);
  };

  const downloadFilteredCsv = async () => {
    if (!searchFile || !previewData) return;

    setIsDownloadingSearch(true);
    setSearchError('');
    setSearchDownloadUrl('');
    setSearchStatus('Filtering and downloading...');

    const parsedLimit = Number.parseInt(rowLimit, 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 0;
    const exportFilters = filters.map((filter) => ({
      column: filter.column,
      operator: filter.operator,
      value: VALUELESS_OPERATORS.has(filter.operator) ? '' : filter.value,
    }));

    const formData = new FormData();
    formData.append('file', searchFile);
    formData.append('filters', JSON.stringify(exportFilters));
    formData.append('limit', String(safeLimit));

    try {
      const response = await fetch('/search', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let message = 'Search failed. Please try again.';
        try {
          const data = await response.json();
          message = data.detail || message;
        } catch {
          message = response.statusText || message;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setSearchDownloadUrl(url);

      const estimatedRows =
        filters.length === 0
          ? formatNumber(previewData.total_rows)
          : safeLimit > 0
            ? `up to ${formatNumber(safeLimit)}`
            : 'matching filtered';
      setSearchStatus(`Download ready. Estimated rows: ${estimatedRows}.`);

      window.setTimeout(() => {
        if (searchDownloadLinkRef.current) {
          searchDownloadLinkRef.current.click();
        }
      }, 0);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Network error. Please check the backend and try again.';
      setSearchError(message);
      setSearchStatus('Search stopped.');
    } finally {
      setIsDownloadingSearch(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8 lg:px-10">
        <header className="py-8 text-center sm:py-12">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">
            DuckDB streaming conversion
          </p>
          <h1 className="mt-4 text-4xl font-extrabold tracking-normal text-white sm:text-6xl">
            Betty Mae Parquet &rarr; CSV Converter
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            Upload a Parquet file and convert it to CSV from your browser. Built for very large
            datasets without loading the full file into memory.
          </p>
        </header>

        <nav className="mb-5 grid grid-cols-2 rounded-lg border border-slate-800 bg-slate-900/70 p-1">
          {[
            { id: 'convert', label: 'Convert' },
            { id: 'search', label: 'Search & Filter' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`h-11 rounded-md text-sm font-bold transition ${
                activeTab === tab.id
                  ? 'bg-cyan-400 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === 'convert' && (
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
                  Click to browse or drag a file onto this area. Files up to 20GB are accepted.
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
                      <p className="break-words text-sm font-semibold text-white">
                        {selectedFile.name}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">{formatBytes(selectedFile.size)}</p>
                    </div>
                  </div>

                  {selectedFile.size > FIVE_GB && (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                      This file is over 10GB, so upload and conversion may take several minutes.
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
        )}

        {activeTab === 'search' && (
          <section className="flex flex-1 flex-col gap-5">
            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-black/30 sm:p-6">
                <button
                  type="button"
                  className={`flex min-h-[240px] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
                    isSearchDragging
                      ? 'border-cyan-300 bg-cyan-300/10 text-cyan-100'
                      : 'border-slate-600 bg-slate-950/50 text-slate-300 hover:border-cyan-400 hover:bg-slate-900'
                  }`}
                  onClick={() => searchFileInputRef.current?.click()}
                  onDrop={handleSearchDrop}
                  onDragOver={handleSearchDragOver}
                  onDragLeave={handleSearchDragLeave}
                  disabled={isLoadingPreview || isDownloadingSearch}
                >
                  <span className="rounded-full bg-cyan-400/10 p-4 text-cyan-300">
                    <DownloadIcon />
                  </span>
                  <span className="mt-6 text-xl font-bold text-white">
                    {searchFile ? searchFile.name : 'Drop your .parquet or .zst file here'}
                  </span>
                  <span className="mt-3 max-w-md text-sm leading-6 text-slate-400">
                    Click to browse or drag a file onto this area. Files up to 20GB are accepted.
                  </span>
                  <input
                    ref={searchFileInputRef}
                    className="hidden"
                    type="file"
                    accept=".parquet,.zst"
                    onChange={handleSearchInputChange}
                  />
                </button>

                <button
                  type="button"
                  onClick={loadPreview}
                  disabled={!searchFile || isLoadingPreview || isDownloadingSearch}
                  className="mt-5 flex h-12 w-full items-center justify-center rounded-lg bg-cyan-400 px-5 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {isLoadingPreview ? (
                    <>
                      <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                      Loading preview...
                    </>
                  ) : (
                    'Load Preview'
                  )}
                </button>
              </div>

              <aside className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-black/30 sm:p-6">
                <h2 className="text-lg font-bold text-white">Search file</h2>

                {searchFile ? (
                  <div className="mt-5 flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    <span className="mt-0.5 text-cyan-300">
                      <FileIcon />
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-white">{searchFile.name}</p>
                      <p className="mt-1 text-sm text-slate-400">{formatBytes(searchFile.size)}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm leading-6 text-slate-400">
                    No file selected yet.
                  </p>
                )}

                <h2 className="mt-6 text-lg font-bold text-white">Status</h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">{searchStatus}</p>

                {(isLoadingPreview || isDownloadingSearch) && (
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full w-1/2 animate-progress rounded-full bg-cyan-300" />
                  </div>
                )}

                {searchError && (
                  <div className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                    {searchError}
                  </div>
                )}

                {searchDownloadUrl && (
                  <a
                    ref={searchDownloadLinkRef}
                    href={searchDownloadUrl}
                    download="filtered_results.csv"
                    className="mt-5 flex h-11 items-center justify-center rounded-lg border border-cyan-300 px-4 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300 hover:text-slate-950"
                  >
                    Download Filtered CSV
                  </a>
                )}
              </aside>
            </div>

            {previewData && (
              <>
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-black/30 sm:p-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-white">Preview</h2>
                      <p className="mt-2 text-3xl font-extrabold text-cyan-200">
                        {formatNumber(previewData.total_rows)} rows found
                      </p>
                    </div>
                    <p className="text-sm text-slate-400">
                      Showing first {formatNumber(previewData.preview_rows?.length || 0)} rows
                    </p>
                  </div>

                  <div className="mt-5 max-h-[480px] overflow-auto rounded-lg border border-slate-800">
                    <table className="min-w-full border-collapse text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-800 text-xs uppercase text-slate-300">
                        <tr>
                          {previewData.columns.map((column) => (
                            <th
                              key={column}
                              className="whitespace-nowrap border-b border-slate-700 px-4 py-3 font-bold"
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-950/50">
                        {previewData.preview_rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="hover:bg-slate-900">
                            {previewData.columns.map((column) => (
                              <td
                                key={`${rowIndex}-${column}`}
                                className="max-w-[280px] whitespace-nowrap px-4 py-3 text-slate-200"
                              >
                                <span className="block overflow-hidden text-ellipsis">
                                  {previewValue(row[column])}
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-black/30 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-xl font-bold text-white">Filter Results</h2>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={addFilter}
                        className="h-10 rounded-lg bg-cyan-400 px-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
                      >
                        Add Filter
                      </button>
                      <button
                        type="button"
                        onClick={clearFilters}
                        disabled={filters.length === 0}
                        className="h-10 rounded-lg border border-slate-700 px-4 text-sm font-bold text-slate-100 transition hover:border-slate-400 hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                      >
                        Clear All Filters
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {filters.length === 0 ? (
                      <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
                        No filters added.
                      </p>
                    ) : (
                      filters.map((filter, index) => (
                        <div
                          key={index}
                          className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto]"
                        >
                          <select
                            value={filter.column}
                            onChange={(event) => updateFilter(index, 'column', event.target.value)}
                            className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white outline-none transition focus:border-cyan-300"
                          >
                            {previewData.columns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>

                          <select
                            value={filter.operator}
                            onChange={(event) => updateFilter(index, 'operator', event.target.value)}
                            className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white outline-none transition focus:border-cyan-300"
                          >
                            {FILTER_OPERATORS.map((operator) => (
                              <option key={operator.value} value={operator.value}>
                                {operator.label}
                              </option>
                            ))}
                          </select>

                          {VALUELESS_OPERATORS.has(filter.operator) ? (
                            <div className="hidden sm:block" />
                          ) : (
                            <input
                              value={filter.value}
                              onChange={(event) => updateFilter(index, 'value', event.target.value)}
                              className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300"
                              placeholder="Value"
                            />
                          )}

                          <button
                            type="button"
                            onClick={() => removeFilter(index)}
                            className="h-11 rounded-lg border border-red-400/50 px-4 text-sm font-bold text-red-200 transition hover:bg-red-500/10"
                            aria-label="Remove filter"
                          >
                            X
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.5fr]">
                    <label className="block">
                      <span className="text-sm font-bold text-slate-200">Limit to X rows (0 = all)</span>
                      <input
                        type="number"
                        min="0"
                        value={rowLimit}
                        onChange={(event) => setRowLimit(event.target.value)}
                        className="mt-2 h-12 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 text-sm text-white outline-none transition focus:border-cyan-300"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={downloadFilteredCsv}
                      disabled={isDownloadingSearch}
                      className="flex h-12 w-full items-center justify-center self-end rounded-lg bg-cyan-400 px-5 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    >
                      {isDownloadingSearch ? (
                        <>
                          <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                          Filtering and downloading...
                        </>
                      ) : (
                        'Download Filtered CSV'
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        <footer className="py-8 text-center text-sm text-slate-500">
          Free tool. Handles 200M+ rows. Powered by DuckDB.
        </footer>
      </div>
    </main>
  );
}
