
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Clock, XCircle, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export default function ProofTracker() {
  const [currentMonth, setCurrentMonth] = useState("December 2024");
  
  // Expanded calendar with more days for the full month view
  const days = [
    { date: 1, day: 'Sun', status: null },
    { date: 2, day: 'Mon', status: 'verified' },
    { date: 3, day: 'Tue', status: null },
    { date: 4, day: 'Wed', status: 'review' },
    { date: 5, day: 'Thu', status: null },
    { date: 6, day: 'Fri', status: 'verified' },
    { date: 7, day: 'Sat', status: null },
    { date: 8, day: 'Sun', status: null },
    { date: 9, day: 'Mon', status: 'rejected' },
    { date: 10, day: 'Tue', status: null },
    { date: 11, day: 'Wed', status: 'verified' },
    { date: 12, day: 'Thu', status: null },
    { date: 13, day: 'Fri', status: 'review' },
    { date: 14, day: 'Sat', status: null },
    { date: 15, day: 'Sun', status: 'verified' },
    { date: 16, day: 'Mon', status: null },
    { date: 17, day: 'Tue', status: null },
    { date: 18, day: 'Wed', status: 'verified' },
    { date: 19, day: 'Thu', status: null },
    { date: 20, day: 'Fri', status: 'review' },
    { date: 21, day: 'Sat', status: null },
    { date: 22, day: 'Sun', status: null },
    { date: 23, day: 'Mon', status: 'verified' },
    { date: 24, day: 'Tue', status: 'review' },
    { date: 25, day: 'Wed', status: 'verified' },
    { date: 26, day: 'Thu', status: null },
    { date: 27, day: 'Fri', status: 'rejected' },
    { date: 28, day: 'Sat', status: 'verified' },
    { date: 29, day: 'Sun', status: null },
    { date: 30, day: 'Mon', status: null },
    { date: 31, day: 'Tue', status: 'verified' }
  ];

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case 'verified': return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'review': return <Clock className="h-3 w-3 text-yellow-500" />;
      case 'rejected': return <XCircle className="h-3 w-3 text-red-500" />;
      default: return null;
    }
  };

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
          <Calendar className="h-5 w-5" />
          <span>Proof Tracker</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Month Navigation */}
        <div className="flex items-center justify-between">
          <button className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ChevronLeft className="h-4 w-4 text-gray-600" />
          </button>
          <h3 className="font-semibold text-gray-900">{currentMonth}</h3>
          <button className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ChevronRight className="h-4 w-4 text-gray-600" />
          </button>
        </div>

        {/* Full Calendar Grid */}
        <div className="grid grid-cols-7 gap-2">
          {days.map((day, index) => (
            <div key={index} className="text-center">
              <div className="text-xs text-gray-500 mb-1">{day.day}</div>
              <div className="relative">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-medium ${
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
