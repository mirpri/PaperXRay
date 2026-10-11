import type { DocumentPage } from "./library.js";

export interface CollectionSummary {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  description: string;
  isOwner: boolean;
  documentCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionMember {
  userId: string;
  displayName: string;
  email: string;
  sharedAt: string;
}

export interface CollectionUserOption {
  id: string;
  displayName: string;
  email: string;
}

export interface CollectionPage {
  collection: CollectionSummary;
  documentsPage: DocumentPage;
  members: CollectionMember[] | null;
}
