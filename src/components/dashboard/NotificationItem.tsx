
import { CheckCircle2, MessageSquare, Award, Bell } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface NotificationItemProps {
  id: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  onClick: (id: string) => void;
}

export default function NotificationItem({
  id,
  type,
  message,
  isRead,
  createdAt,
  onClick,
}: NotificationItemProps) {
  const getIcon = () => {
    switch (type) {
      case 'task':
        return <CheckCircle2 className="h-4 w-4 text-blue-600" />;
      case 'feedback':
        return <MessageSquare className="h-4 w-4 text-green-600" />;
      case 'achievement':
        return <Award className="h-4 w-4 text-yellow-600" />;
      default:
        return <Bell className="h-4 w-4 text-gray-600" />;
    }
  };

  const handleClick = () => {
    if (!isRead) {
      onClick(id);
    }
  };

  const timeAgo = formatDistanceToNow(new Date(createdAt), { addSuffix: true });

  return (
    <div
      className={`p-3 hover:bg-gray-50 cursor-pointer transition-colors ${
        !isRead ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
      }`}
      onClick={handleClick}
    >
      <div className="flex items-start space-x-3">
        <div className="mt-0.5">{getIcon()}</div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm leading-relaxed ${!isRead ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
            {message}
          </p>
          <p className="text-xs text-gray-500 mt-1">{timeAgo}</p>
        </div>
        {!isRead && (
          <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
        )}
      </div>
    </div>
  );
}
