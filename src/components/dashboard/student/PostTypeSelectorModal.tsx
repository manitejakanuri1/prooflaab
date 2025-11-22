import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PostTypeSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PostTypeSelectorModal = ({ open, onOpenChange }: PostTypeSelectorModalProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Post</DialogTitle>
          <DialogDescription>
            Choose what type of post you want to create
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">
            Post type selector will be implemented here
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PostTypeSelectorModal;
