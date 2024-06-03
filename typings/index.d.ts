/// <reference types="node" />
interface Options {
    address: string;
    port?: number;
    server_port: number;
    client_port: number;
    abort?: boolean;
}
interface Response {
    server_port: number;
    client_port: number;
    status: string;
    opsys?: string;
    userid?: string | Buffer;
    error?: string;
    charset?: string;
}
declare const Errors: {
    UNDEFINED_LOCAL_ADDRESS: string;
    UNDEFINED_SERVER_PORT: string;
    UNDEFINED_LOCAL_PORT: string;
    INVALID_RESPONSE_LENGTH: string;
    INVALID_STATUS_RESPONSE: string;
    INVALID_OPSYS_RESPONSE: string;
    INVALID_CHARSET_RESPONSE: string;
    INVALID_USERID_LENGTH: string;
    INVALID_ERROR_TOKEN: string;
};
declare class Identd {
    private static checkOptions;
    /**
     * Clients should feel free to abort a connection if they receive 1000 characters without receiving an <EOL>.
     * this is for whitespaces, bcs the response could have a lot of whitespaces if the server wants it
     * maybe check if the query ports correspond with requested ports ?
     * --
     * Any premature close (i.e., one where the client does not receive the EOL, whether graceful or an abort should
     * be considered to have the same meaning as "ERROR : UNKNOWN-ERROR".
     */
    static request(options: Options): Promise<Response>;
    /**
     * Check if is there end of line in the buffer without converting it
     * to string making it more faster; extra mem usage, etc.
     */
    private static isEOL;
    /**
     * <reply> ::= <reply-text> <EOL>
     * <reply-text> ::= <error-reply> | <ident-reply>
     * <port-pair> ::= <integer> "," <integer>
     * <integer> ::= 1*5<digit> ; 1-5 digits.
     * <error-reply> ::= <port-pair> ":" "ERROR" ":" <error-type>
     * <ident-reply> ::= <port-pair> ":" "USERID" ":" <opsys-field> ":" <user-id>
     * <error-type> ::= "INVALID-PORT" | "NO-USER" | "UNKNOWN-ERROR" | "HIDDEN-USER" |  <error-token>
     * <opsys-field> ::= <opsys> [ "," <charset>]
     * <opsys> ::= "OTHER" | "UNIX" | <token> ...etc. ;  (See "Assigned Numbers")
     * <charset> ::= "US-ASCII" | ...etc.;  (See "Assigned Numbers")
     * <user-id> ::= <octet-string> ; 512 character limit
     * <token> ::= 1*64<token-characters> ; 1-64 characters, 64 limit
     * <error-token> ::= "X"1*63<token-characters>; 2-64 chars beginning w/X
     * --
     * <token-characters> ::= <Any of these ASCII characters: a-z, A-Z,
     * - (dash), .!@#$%^&*()_=+.,<>/?"'~`{}[]; >
     * ; upper and lowercase a-z plus
     * ; printables minus the colon ":"
     * ; character.
     * --
     * all other fields will be defined in and must be sent as US-ASCII.
     * --
     * space characters (040) following the colon separator ARE part of the identifier string and
     * may not be ignored.
     * --
     * "OTHER" indicates the identifier is an unformatted character string.
     * this just means that is not an user indentification, could be a email or tel number, etc.
     * --
     * the concept of token is just the <opsys> value
     * no white spaces in token
     * --
     * only the beggining and ending white spaces will be taken as a part of the userid
     */
    private static parseResponse;
    private static defaultDecode;
    private static splitBuffer;
    private static buildRequest;
    private static isValidOS;
    private static isValidCharset;
    private static isValidUserID;
    private static isValidErrorToken;
}
export default Identd;
export { Errors };
