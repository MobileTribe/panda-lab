import * as admin from "firebase-admin";
import {Job, JobRequest, JobStatus, JobTask, TaskStatus, TestStatus} from "pandalab-commons";
import DocumentReference = admin.firestore.DocumentReference;
import Timestamp = admin.firestore.Timestamp;
import DocumentSnapshot = admin.firestore.DocumentSnapshot;


export enum JobError {
    NOT_DEBUG = "Artifact type has to be debug",
    TEST_APK_NOT_FOUND = "Test artifact not found",
    NO_DEVICE_FOUND = "No device found"
}

class JobService {

    async createJob(job: JobRequest): Promise<DocumentReference> {
        //Check if artifact exist
        const artifactDoc = await admin.firestore().doc(job.artifact).get();
        if (!artifactDoc.exists || artifactDoc.get("type") !== "debug") {
            throw JobError.NOT_DEBUG;
        }

        //Check if artifact has test apk
        const artifactsCollection = artifactDoc.ref.parent;
        const artifactTestDocs = await artifactsCollection
            .where("type", "==", "test")
            .where("buildType", "==", artifactDoc.get("buildType"))
            .where("flavor", "==", artifactDoc.get("flavor")).limit(1).get();

        if (artifactTestDocs.empty) {
            throw JobError.TEST_APK_NOT_FOUND;
        }
        const artifactTestDoc = artifactTestDocs.docs[0];

        //Check devices ids
        const devicesQuery: string[][] = await Promise.all(
            job.groups.map(async (group: string) => {
                const result = await admin.firestore().collection("deviceGroups").doc(group).collection("devices").get();
                return result.docs.map(doc => doc.id)
            })
        );
        let devicesList = devicesQuery.reduce((prev, curr) => prev.concat(curr), []);
        devicesList = devicesList.concat(job.devices);

        const devicesSet = new Set<string>();
        devicesList.map(device => devicesSet.add(device));


        //No device set we use all devices by default
        let finalDevices: string[] = [];
        if (devicesList.length === 0) {
            finalDevices = (await admin.firestore().collection("devices").listDocuments()).map(value => value.id)
        } else {
            finalDevices = await Promise.all(Array.from<string>(devicesSet.values()).filter(async deviceId => {
                const deviceDoc = await admin.firestore().collection("devices").doc(deviceId).get();
                return deviceDoc.exists
            }));
        }

        if (finalDevices.length === 0) {
            throw JobError.NO_DEVICE_FOUND
        }

        let taskCount: number = finalDevices.length;
        if (job.devicesCount > 0) {
            taskCount = Math.min(job.devicesCount, finalDevices.length)
        }


        //Create job and tasks
        const createdJob = {
            apk: artifactDoc.ref,
            apk_test: artifactTestDoc.ref,
            completed: false,
            status: JobStatus.pending
        } as Job;

        const jobRef = await admin.firestore().collection('jobs').add(createdJob);

        await Promise.all(new Array(taskCount).fill(0).map(
            async () => {
                const taskObj = {
                    job: admin.firestore().collection('jobs').doc(jobRef.id),
                    devices: finalDevices,
                    status: TaskStatus.pending,
                } as JobTask;
                return await admin.firestore().collection('jobs-tasks').add(taskObj);
            }
        ));

        return jobRef
    }


    async onTaskUpdate(taskDoc: DocumentSnapshot) {
        const task = taskDoc.data() as JobTask;
        if (task.status === TaskStatus.pending) {
            console.log("task pending. skip job update");
            return
        }

        const jobRef = task.job;

        const tasksList = await admin.firestore().collection("jobs-tasks").where("job", "==", jobRef).get();


        const jobTasks = tasksList.docs.map(value => value.data() as JobTask);
        const finishTasks = jobTasks.filter(value => value.completed).length;


        console.log(`Job progress : ${finishTasks} / ${jobTasks.length}`);
        // compare if is same size
        const completed = jobTasks.length === finishTasks;

        let jobStatus = JobStatus.inprogress;
        if (completed) {
            const hasTestFailure = jobTasks.filter(value => value.status === TaskStatus.success)
                .filter(value => value.result.results
                    .filter(r => r.installFailed || r.tests.filter(test => test.status !== TestStatus.pass).length > 0)
                    .length > 0
                ).length > 0;

            const hasErrorTask = jobTasks.filter(value => value.status === TaskStatus.error).length > 0;

            if (hasTestFailure) {
                jobStatus = JobStatus.failure
            } else if (hasErrorTask) {
                jobStatus = JobStatus.unstable
            } else {
                jobStatus = JobStatus.success
            }
        }
        return await jobRef.set({completed: completed, status: jobStatus}, {merge: true});


    }

    async checkTaskTimeout() {
        const timeoutTasks = await admin.firestore().collection('jobs-tasks')
            .where("completed", "==", false)
            .where("timeout", '<', Timestamp.now())
            .get();

        return Promise.all(timeoutTasks.docs.map(async doc => {
            return await doc.ref.set({
                status: TaskStatus.error,
                error: 'Timeout reached',
                completed: true,
            } as JobTask, {merge: true})
        }))
    }

}


export const jobService = new JobService();