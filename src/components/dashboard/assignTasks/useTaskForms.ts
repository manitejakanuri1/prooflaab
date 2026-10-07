import { useState } from "react";

/**
 * The four task-composition forms behind the assign-tasks tabs.
 *
 * The admin screen and the college screen were built by copying one into the
 * other. Their layouts, validation and save paths have since diverged, but this
 * part never did — the state shapes, the active-tab accessors and the clear
 * buttons were byte-identical in both files. This is the one copy.
 *
 * Each tab keeps its own draft on purpose: switching from Manual to AI and back
 * must not wipe what you typed. The clear buttons deliberately leave due date
 * and visibility alone, since those are the settings you least want to retype.
 */

export interface PersonalizedTask {
  id: string;
  studentId: string;
  studentName: string;
  studentBranch: string | null;
  studentYear: string | null;
  title: string;
  description: string;
  selected: boolean;
  isEditing: boolean;
}

const manualDefaults = {
  title: "",
  description: "",
  xpReward: "",
  dueDate: undefined as Date | undefined,
  category: "Coding",
  visibility: "Public",
  attachmentType: "url" as "url" | "file",
  attachmentUrl: "",
  attachmentFile: null as File | null,
};

const aiDefaults = {
  selectedBranch: "",
  topicArea: "",
  dueDate: undefined as Date | undefined,
  visibility: "Public",
  title: "",
  description: "",
  xpReward: "",
  generated: false,
};

const templateDefaults = {
  selectedTemplate: "",
  title: "",
  description: "",
  xpReward: "",
  dueDate: undefined as Date | undefined,
  category: "Coding",
  visibility: "Public",
};

const personalDefaults = {
  title: "",
  description: "",
  xpReward: "",
  dueDate: undefined as Date | undefined,
  category: "Coding",
  visibility: "Public",
};

export function useTaskForms(activeTab: string) {
  const [manualForm, setManualForm] = useState(manualDefaults);
  const [aiForm, setAiForm] = useState(aiDefaults);
  const [templateForm, setTemplateForm] = useState(templateDefaults);
  const [personalForm, setPersonalForm] = useState(personalDefaults);

  const getActiveForm = () => {
    switch (activeTab) {
      case "manual":
        return manualForm;
      case "ai":
        return aiForm;
      case "template":
        return templateForm;
      case "personalized":
        return personalForm;
      default:
        return manualForm;
    }
  };

  const updateActiveForm = (updates: Partial<any>) => {
    switch (activeTab) {
      case "manual":
        setManualForm((prev) => ({ ...prev, ...updates }));
        break;
      case "ai":
        setAiForm((prev) => ({ ...prev, ...updates }));
        break;
      case "template":
        setTemplateForm((prev) => ({ ...prev, ...updates }));
        break;
      case "personalized":
        setPersonalForm((prev) => ({ ...prev, ...updates }));
        break;
    }
  };

  const currentForm = getActiveForm();

  // Each clear button wipes the text but keeps due date and visibility, which
  // are the settings a user least wants to re-pick.
  const clearManualTask = () =>
    setManualForm((prev) => ({ ...prev, title: "", description: "", xpReward: "", category: "" }));

  const clearAITask = () =>
    setAiForm((prev) => ({ ...prev, title: "", description: "", xpReward: "", generated: false }));

  const clearTemplate = () =>
    setTemplateForm((prev) => ({
      ...prev,
      selectedTemplate: "",
      title: "",
      description: "",
      xpReward: "",
    }));

  const clearPersonalForm = () =>
    setPersonalForm((prev) => ({ ...prev, title: "", description: "", xpReward: "" }));

  return {
    manualForm,
    setManualForm,
    aiForm,
    setAiForm,
    templateForm,
    setTemplateForm,
    personalForm,
    setPersonalForm,

    getActiveForm,
    updateActiveForm,

    // Whatever the visible tab currently holds.
    title: currentForm.title || "",
    description: currentForm.description || "",
    xpReward: currentForm.xpReward || "",
    dueDate: currentForm.dueDate,
    visibility: currentForm.visibility || "Public",
    category: "category" in currentForm ? currentForm.category : "Coding",

    // Fields only one tab has.
    selectedBranch: aiForm.selectedBranch,
    topicArea: aiForm.topicArea,
    selectedTemplate: templateForm.selectedTemplate,
    attachmentType: manualForm.attachmentType,
    attachmentUrl: manualForm.attachmentUrl,
    attachmentFile: manualForm.attachmentFile,

    clearManualTask,
    clearAITask,
    clearTemplate,
    clearPersonalForm,
  };
}
