/**
 * Unit tests for Download Manager
 * Tests Phase 4 Task 4.1: Core Download Engine
 */

// Mock Chrome APIs
const mockChrome = {
  tabs: {
    create: jest.fn(),
    remove: jest.fn(() => Promise.resolve()),
    sendMessage: jest.fn(),
    onUpdated: {
      addListener: jest.fn()
    },
    
    onRemoved: { 
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  downloads: {
    download: jest.fn(),
    cancel: jest.fn(() => Promise.resolve()),
    onChanged: {
      addListener: jest.fn()
    }
  },
  runtime: {
    lastError: null
  }
};

// Set up global chrome mock
global.chrome = mockChrome;

// Import after setting up mocks
const DownloadManager = require('../../lib/download-manager.js');

// Main test suite, all other suites must be nested inside this block
describe('DownloadManager', () => {
  let downloadManager;
  let mockPurchaseItem;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create new instance
    downloadManager = new DownloadManager();

    // Create mock purchase item
    mockPurchaseItem = {
      title: 'Test Album',
      artist: 'Test Artist',
      downloadUrl: 'https://bandcamp.com/download/album?id=123456',
      albumArt: 'https://example.com/artwork.jpg'
    };
  });

  describe('Single Download Functionality', () => {
    test('should create DownloadManager instance', () => {
      expect(downloadManager).toBeDefined();
      expect(downloadManager.activeDownload).toBeNull();
      expect(downloadManager.downloadProgress).toEqual({});
    });

    test('should open download page in inactive tab', async () => {
      const mockTabId = 123;
      mockChrome.tabs.create.mockResolvedValue({ id: mockTabId });

      const downloadPromise = downloadManager.download(mockPurchaseItem);

      // Should create tab with download URL
      expect(mockChrome.tabs.create).toHaveBeenCalledWith({
        url: mockPurchaseItem.downloadUrl,
        active: false
      });

      // Cleanup
      downloadManager.cancel();
      await expect(downloadPromise).rejects.toThrow('Download cancelled');
    });

    test('should monitor tab for download link readiness', async () => {
      const mockTabId = 123;
      mockChrome.tabs.create.mockResolvedValue({ id: mockTabId });

      // Mock sendMessage to never be ready
      mockChrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
        if (message.type === 'CHECK_DOWNLOAD_READY') {
          callback({ ready: false });
        }
      });

      // Start download (don't await - we're testing the monitoring state)
      const downloadPromise = downloadManager.download(mockPurchaseItem);

      // Allow promise to settle
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should set up monitoring for the tab
      expect(downloadManager.activeDownload).toBeTruthy();
      expect(downloadManager.activeDownload.tabId).toBe(mockTabId);
      expect(downloadManager.activeDownload.status).toBe('preparing');

      // Cleanup - cancel and catch the rejection
      downloadManager.cancel();
      await expect(downloadPromise).rejects.toThrow('Download cancelled');
    });

    test('should extract download link when ready', async () => {
      const mockTabId = 123;
      const mockDownloadUrl = 'https://p4.bcbits.com/download/track/abc123';
      const mockDownloadId = 456;

      mockChrome.tabs.create.mockResolvedValue({ id: mockTabId });
      mockChrome.downloads.download.mockResolvedValue(mockDownloadId);
      mockChrome.tabs.remove.mockResolvedValue();

      // Simulate content script response with download link ready
      mockChrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
        if (message.type === 'CHECK_DOWNLOAD_READY') {
          setTimeout(() => callback({ ready: true, url: mockDownloadUrl }), 0);
        }
      });

      const downloadPromise = downloadManager.download(mockPurchaseItem);

      // Wait for monitoring to start and check to happen
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Should have sent message to check if download is ready
      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        mockTabId,
        { type: 'CHECK_DOWNLOAD_READY' },
        expect.any(Function)
      );

      // Cleanup
      downloadManager.cancel();
      await expect(downloadPromise).rejects.toThrow('Download cancelled');
    });

    test('should initiate download using Chrome Downloads API', async () => {
      const mockTabId = 123;
      const mockDownloadUrl = 'https://p4.bcbits.com/download/track/abc123';
      const mockDownloadId = 456;

      mockChrome.tabs.create.mockResolvedValue({ id: mockTabId });
      mockChrome.downloads.download.mockResolvedValue(mockDownloadId);
      mockChrome.tabs.remove.mockResolvedValue();

      // Simulate content script response with download link ready immediately
      mockChrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
        if (message.type === 'CHECK_DOWNLOAD_READY') {
          // Return ready immediately
          callback({ ready: true, url: mockDownloadUrl });
        }
      });

      const downloadPromise = downloadManager.download(mockPurchaseItem);

      // Wait for monitoring cycle to complete
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Should have initiated download
      expect(mockChrome.downloads.download).toHaveBeenCalledWith({
        url: mockDownloadUrl,
        saveAs: false
      });

      // Should track the download ID
      expect(downloadManager.activeDownload.downloadId).toBe(mockDownloadId);

      // Cleanup
      downloadManager.cancel();
      await expect(downloadPromise).rejects.toThrow('Download cancelled');
    });

    test('should close tab after initiating download', async () => {
      const mockTabId = 123;
      const mockDownloadUrl = 'https://p4.bcbits.com/download/track/abc123';
      const mockDownloadId = 456;

      mockChrome.tabs.create.mockResolvedValue({ id: mockTabId });
      mockChrome.downloads.download.mockResolvedValue(mockDownloadId);
      mockChrome.tabs.remove.mockResolvedValue();

      // Simulate content script response with download link ready
      mockChrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
        if (message.type === 'CHECK_DOWNLOAD_READY') {
          callback({ ready: true, url: mockDownloadUrl });
        }
      });

      const downloadPromise = downloadManager.download(mockPurchaseItem);

      // Wait for monitoring and download initiation to complete
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Should have closed the tab
      expect(mockChrome.tabs.remove).toHaveBeenCalledWith(mockTabId);

      // Cleanup
      downloadManager.cancel();
      await expect(downloadPromise).rejects.toThrow('Download cancelled');
    });

    test('should track download progress', async () => {
      const mockDownloadId = 456;
      const progressCallback = jest.fn();

      // Set up progress listener
      downloadManager.onProgress = progressCallback;

      // Simulate progress update
      const progressDelta = {
        id: mockDownloadId,
        state: { current: 'in_progress' },
        bytesReceived: { current: 5000000 },
        totalBytes: { current: 10000000 }
      };

      // Get the listener that was registered
      const onChangedListener = mockChrome.downloads.onChanged.addListener.mock.calls[0]?.[0];

      if (onChangedListener) {
        // Simulate download with active download
        downloadManager.activeDownload = {
          downloadId: mockDownloadId,
          totalBytes: 10000000
        };

        onChangedListener(progressDelta);

        // Should have called progress callback
        expect(progressCallback).toHaveBeenCalledWith({
          downloadId: mockDownloadId,
          bytesReceived: 5000000,
          totalBytes: 10000000,
          percentComplete: 50
        });
      }
    });

    test('should handle download completion', async () => {
      const mockDownloadId = 456;

      // Get the listener that was registered
      const onChangedListener = mockChrome.downloads.onChanged.addListener.mock.calls[0]?.[0];

      if (onChangedListener) {
        // Simulate download with active download
        const mockResolve = jest.fn();
        const mockReject = jest.fn();

        downloadManager.activeDownload = {
          downloadId: mockDownloadId,
          purchaseItem: mockPurchaseItem,
          promise: {
            resolve: mockResolve,
            reject: mockReject
          }
        };

        // Simulate completion
        const completeDelta = {
          id: mockDownloadId,
          state: { current: 'complete' }
        };

        onChangedListener(completeDelta);

        // Should resolve the promise
        expect(mockResolve).toHaveBeenCalled();

        // Should clear active download
        expect(downloadManager.activeDownload).toBeNull();
      }
    });

    test('should handle download errors', async () => {
      const mockTabId = 123;

      mockChrome.tabs.create.mockRejectedValue(new Error('Tab creation failed'));

      // Should reject the promise
      await expect(downloadManager.download(mockPurchaseItem)).rejects.toThrow('Tab creation failed');

      // Should clear active download
      expect(downloadManager.activeDownload).toBeNull();
    });

    test('should timeout if download link never appears', async () => {
      jest.useFakeTimers();

      const mockTabId = 123;
      mockChrome.tabs.create.mockResolvedValue({ id: mockTabId });

      // Simulate content script always returning "not ready"
      mockChrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
        if (message.type === 'CHECK_DOWNLOAD_READY') {
          callback({ ready: false });
        }
      });

      const downloadPromise = downloadManager.download(mockPurchaseItem);

      // Fast-forward through all checks (15 checks * 2000ms = 30000ms)
      for (let i = 0; i < 16; i++) {
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
      }

      // Should reject with timeout error
      await expect(downloadPromise).rejects.toThrow('Download preparation timeout');

      jest.useRealTimers();
    }, 15000); // Increase test timeout
  });

  describe('Acceptance Criteria', () => {
    test('AC4.1.1: Successfully downloads a single purchase item', async () => {
      const mockTabId = 123;
      const mockDownloadUrl = 'https://p4.bcbits.com/download/track/abc123';
      const mockDownloadId = 456;

      mockChrome.tabs.create.mockResolvedValue({ id: mockTabId });
      mockChrome.downloads.download.mockResolvedValue(mockDownloadId);
      mockChrome.tabs.remove.mockResolvedValue();

      mockChrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
        if (message.type === 'CHECK_DOWNLOAD_READY') {
          callback({ ready: true, url: mockDownloadUrl });
        }
      });

      // Start download
      const downloadPromise = downloadManager.download(mockPurchaseItem);

      // Wait for full download cycle
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Simulate download completion
      downloadManager.handleDownloadChange({
        id: mockDownloadId,
        state: { current: 'complete' }
      });

      // Wait for promise to resolve
      const result = await downloadPromise;
      expect(result.success).toBe(true);

      // Verify complete flow
      expect(mockChrome.tabs.create).toHaveBeenCalled();
      expect(mockChrome.tabs.sendMessage).toHaveBeenCalled();
      expect(mockChrome.downloads.download).toHaveBeenCalled();
      expect(mockChrome.tabs.remove).toHaveBeenCalled();
    }, 15000);
  });
  

  describe('Network Failure Tests', () => {
    test('should handle download URL returning 404', async () => {
      mockChrome.tabs.create.mockResolvedValue({ id: 123 });
      mockChrome.downloads.download.mockRejectedValue(new Error('Download failed: The server responded with a 404 Not Found.'));

      await expect(downloadManager.download(mockPurchaseItem)).rejects.toThrow('The server responded with a 404 Not Found');

      expect(mockChrome.tabs.remove).toHaveBeenCalled(); 
    }, 15000);

    test('should handle download interrupted by network timeout', async () => {
      mockChrome.tabs.create.mockResolvedValue({ id: 123 });
      mockChrome.downloads.download.mockRejectedValue(new Error('Download failed: Network timeout.'));

      await expect(downloadManager.download(mockPurchaseItem)).rejects.toThrow('Network timeout');

      expect(mockChrome.tabs.remove).toHaveBeenCalled();
    }, 15000); 
  });

  describe('Chrome API Permission Errors', () => {
    test('should handle missing Chrome Downloads API permission', async () => {
      const downloadSpy = jest.spyOn(mockChrome.downloads, 'download').mockImplementation(() => {
        mockChrome.runtime.lastError = { message: 'The "downloads" permission is missing.' };
        return Promise.reject(new Error('API permission missing'));
      });
      mockChrome.tabs.create.mockResolvedValue({ id: 123 });

      await expect(downloadManager.download(mockPurchaseItem)).rejects.toThrow('The "downloads" permission is missing');
      expect(downloadSpy).toHaveBeenCalled();
    }, 15000); 

    test('should handle tab creation permission being denied', async () => {
      mockChrome.tabs.create.mockRejectedValue(new Error('Permissions to create a tab are denied.'));

      await expect(downloadManager.download(mockPurchaseItem)).rejects.toThrow('Permissions to create a tab are denied.');
      expect(downloadManager.activeDownload).toBeNull();
    });

    test('should handle sendMessage failing due to permission issues', async () => {
      mockChrome.tabs.create.mockResolvedValue({ id: 123 });
      mockChrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
        mockChrome.runtime.lastError = { message: 'Cannot access tab with ID 123.' };
        callback();
      });
      
      jest.useFakeTimers();
      const downloadPromise = downloadManager.download(mockPurchaseItem);
      jest.advanceTimersByTime(2500);

      await expect(downloadPromise).rejects.toThrow('Cannot access tab with ID 123.');

      jest.useRealTimers();
      expect(mockChrome.tabs.remove).toHaveBeenCalled();
    }, 15000); 
  });

  describe('Concurrent Download Attempts', () => {
    let mockSecondPurchaseItem;

    beforeEach(() => {
      mockSecondPurchaseItem = {
        title: 'Second Test Album',
        artist: 'Second Test Artist',
        downloadUrl: 'https://bandcamp.com/download/album?id=654321',
        albumArt: 'https://example.com/artwork2.jpg'
      };
      mockChrome.tabs.create.mockResolvedValue({ id: 123 }); 
    });

    test('should throw an error when a download is already in progress', async () => {
      downloadManager.activeDownload = {
        purchaseItem: mockPurchaseItem,
        status: 'in_progress'
      };
      
      await expect(downloadManager.download(mockSecondPurchaseItem)).rejects.toThrow('A download is already in progress. Please wait for it to complete.');
      
      expect(downloadManager.activeDownload).toBeDefined();
      expect(downloadManager.activeDownload.purchaseItem.title).toBe('Test Album');

      downloadManager.activeDownload = null;
    });

    test('that the error message is clear and actionable', async () => {
    
      downloadManager.activeDownload = { status: 'in_progress' };
      try {
        await downloadManager.download(mockSecondPurchaseItem);
      } catch (e) {
       
        expect(e.message).toBe('A download is already in progress. Please wait for it to complete.');
      }
      downloadManager.activeDownload = null;
    });
  });

  describe('Tab Lifecycle Issues', () => {
    test('should cancel download when tab is closed by user', async () => {
      const mockTabId = 123;
      mockChrome.tabs.create.mockResolvedValue({ id: mockTabId });

      const downloadPromise = downloadManager.download(mockPurchaseItem);

      await new Promise(resolve => setTimeout(resolve, 0));

      const tabRemovedListener = mockChrome.tabs.onRemoved.addListener.mock.calls[0]?.[0];
      
      expect(tabRemovedListener).toBeDefined(); 

      if (tabRemovedListener) {
        tabRemovedListener(mockTabId);
      }
      
      await expect(downloadPromise).rejects.toThrow('Tab was closed by user');
      expect(downloadManager.activeDownload).toBeNull();
    }, 15000); 
  });

  describe('URL Validation Tests', () => {
   
    test('should reject invalid URLs', async () => {
      const invalidItem = { ...mockPurchaseItem, downloadUrl: 'not-a-valid-url' };
      await expect(downloadManager.download(invalidItem)).rejects.toThrow('Invalid download URL format');
      expect(downloadManager.activeDownload).toBeNull();
    });

    test('should reject non-bcbits.com domains', async () => {
      const invalidDomainItem = { ...mockPurchaseItem, downloadUrl: 'https://other-site.com/download/album?id=123' };
      await expect(downloadManager.download(invalidDomainItem)).rejects.toThrow('URL must be from a supported domain: bandcamp.com');
      expect(downloadManager.activeDownload).toBeNull();
    });

    test('should reject HTTP (non-HTTPS) URLs', async () => {
      const httpItem = { ...mockPurchaseItem, downloadUrl: 'http://bandcamp.com/download/album?id=123' };
      await expect(downloadManager.download(httpItem)).rejects.toThrow('URL must use the HTTPS protocol.');
      expect(downloadManager.activeDownload).toBeNull();
    });
  });
  
}); // End of the main DownloadManager describe block
