import {Timestamp} from 'rxjs';
import {DeviceLog} from './device';
import {DeviceStatus} from 'pandalab-commons';

export interface DeviceAdb {
    uid: string;
    appBuildTime: number;
    id: string;
    type: string;
    path: string;
    deviceState: DeviceStatus;
    deviceLogs: Array<Timestamp<DeviceLog>>;
}

export interface AdbStatus {
    state: AdbStatusState;
    time: number;
}

export enum AdbStatusState {
    STARTED = "listening",
    STOPPED = "stopped",
    LOADING = "loading"
}

export interface LogcatMessage {
    pid: number;
    tid: number;
    tag: string;
    message: string;
}
