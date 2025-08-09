import { useState } from "react";
import { File, Github, ExternalLink, Image, FileText, Video } from "lucide-react";

interface FileThumbnailProps {
  fileUrl: string | null;
  fileName?: string;
  className?: string;
  onLoad?: () => void;
}

export const FileThumbnail = ({ fileUrl, fileName, className = "", onLoad }: FileThumbnailProps) => {
  const [imageError, setImageError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  if (!fileUrl) {
    return (
      <div className={`bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center ${className}`}>
        <div className="text-center p-4">
          <File className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-xs text-gray-500">No file attached</p>
        </div>
      </div>
    );
  }

  const getFileType = (url: string): string => {
    const extension = url.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension)) return 'image';
    if (['mp4', 'webm', 'ogg', 'mov'].includes(extension)) return 'video';
    if (['pdf'].includes(extension)) return 'pdf';
    if (url.includes('github.com') || url.includes('gitlab.com')) return 'github';
    return 'document';
  };

  const fileType = getFileType(fileUrl);
  const name = fileName || fileUrl.split('/').pop() || 'Unknown file';

  const handleImageLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const renderThumbnail = () => {
    switch (fileType) {
      case 'image':
        return (
          <div className="relative w-full h-full">
            {!isLoaded && (
              <div className="absolute inset-0 bg-gray-200 animate-pulse rounded-lg" />
            )}
            <img
              src={fileUrl}
              alt={name}
              className={`w-full h-full object-cover rounded-lg transition-opacity duration-300 ${
                isLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={handleImageLoad}
              onError={() => setImageError(true)}
              loading="lazy"
            />
            {imageError && (
              <div className="absolute inset-0 bg-gray-100 border border-gray-300 rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <Image className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">Image unavailable</p>
                </div>
              </div>
            )}
          </div>
        );
      
      case 'video':
        return (
          <div className="w-full h-full bg-gray-900 rounded-lg flex items-center justify-center relative overflow-hidden">
            <video
              src={fileUrl}
              className="w-full h-full object-cover rounded-lg"
              onLoadedData={handleImageLoad}
              muted
              preload="metadata"
            />
            <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
              <Video className="h-12 w-12 text-white" />
            </div>
          </div>
        );
      
      case 'github':
        return (
          <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg flex items-center justify-center">
            <div className="text-center text-white">
              <Github className="h-12 w-12 mx-auto mb-2" />
              <p className="text-sm font-medium">GitHub Repository</p>
            </div>
          </div>
        );
      
      case 'pdf':
        return (
          <div className="w-full h-full bg-red-50 border-2 border-red-200 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <FileText className="h-12 w-12 text-red-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-red-700">PDF Document</p>
            </div>
          </div>
        );
      
      default:
        return (
          <div className="w-full h-full bg-blue-50 border-2 border-blue-200 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <File className="h-12 w-12 text-blue-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-blue-700">Document</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className={`relative group cursor-pointer ${className}`}>
      {renderThumbnail()}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
        <ExternalLink className="h-6 w-6 text-white" />
      </div>
    </div>
  );
};