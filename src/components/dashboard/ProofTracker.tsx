
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Clock, XCircle, Calendar } from "lucide-react";

export default function ProofTracker() {
  const currentMonth = "September 2024";
  const days = [
    { date: 22, day: 'Mon', status: null },
    { date: 23, day: 'Tue', status: 'verified' },
    { date: 24, day: 'Wed', status: 'review' },
    { date: 25, day: 'Thu', status: 'verified' },
    { date: 26, day: 'Fri', status: null },
    { date: 27, day: 'Sat', status: 'rejected' }
  ];

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case 'verified': return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'review': return <Clock className="h-3 w-3 text-yellow-500" />;
      case 'rejected': return <XCircle className="h-3 w-3 text-red-500" />;
      default: return null;
    }
  };

  const mockEvents = [
    {
      time: '8:00 am',
      title: 'Weekly Team Sync',
      subtitle: 'Discuss progress on projects',
      attendees: 3
    },
    {
      time: '9:00 am',
      title: 'Onboarding Session',
      subtitle: 'Introduction for new hires',
      attendees: 2
    }
  ];

  return (
    <Card className="bg-white/60 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
          <Calendar className="h-5 w-5" />
          <span>Proof Tracker</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Month Navigation */}
        <div className="text-center">
          <h3 className="font-semibold text-gray-900">{currentMonth}</h3>
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-6 gap-3">
          {days.map((day, index) => (
            <div key={index} className="text-center">
              <div className="text-xs text-gray-500 mb-1">{day.day}</div>
              <div className="relative">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium ${
                  day.status ? 'bg-gray-100' : 'bg-gray-50'
                } hover:bg-gray-200 cursor-pointer transition-colors`}>
                  {day.date}
                </div>
                {day.status && (
                  <div className="absolute -top-1 -right-1">
                    {getStatusIcon(day.status)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Events/Submissions */}
        <div className="space-y-3">
          {mockEvents.map((event, index) => (
            <div key={index} className="flex items-center space-x-3 p-3 bg-gray-900 rounded-2xl text-white">
              <div className="text-xs font-medium text-gray-300">{event.time}</div>
              <div className="flex-1">
                <div className="text-sm font-medium">{event.title}</div>
                <div className="text-xs text-gray-300">{event.subtitle}</div>
              </div>
              <div className="flex -space-x-1">
                {Array.from({ length: event.attendees }).map((_, i) => (
                  <div key={i} className="w-6 h-6 bg-gray-600 rounded-full border-2 border-gray-900"></div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex justify-center space-x-4 text-xs">
          <div className="flex items-center space-x-1">
            <CheckCircle className="h-3 w-3 text-green-500" />
            <span className="text-gray-600">Verified</span>
          </div>
          <div className="flex items-center space-x-1">
            <Clock className="h-3 w-3 text-yellow-500" />
            <span className="text-gray-600">Under Review</span>
          </div>
          <div className="flex items-center space-x-1">
            <XCircle className="h-3 w-3 text-red-500" />
            <span className="text-gray-600">Rejected</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
