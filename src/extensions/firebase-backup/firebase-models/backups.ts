import { Helpee } from "../../../models/member-states";

type QueueBackup = {
    studentsInQueue: ReadonlyArray<Omit<Helpee, 'member'|'queue'> & {
        displayName: string,
        memberId: string
    }>;
    name: string;
    parentCategoryId: string;
};

type ServerBackup = {
    serverName: string;
    timeStamp: Date;
    queues: QueueBackup[];
    afterSessionMessage: string;
}

export { QueueBackup, ServerBackup };