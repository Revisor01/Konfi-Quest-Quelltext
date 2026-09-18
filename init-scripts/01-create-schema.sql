-- ====================================================================
-- Konfi Quest — Schema einer NEUEN Instanz
--
-- ERZEUGT, NICHT VON HAND GEPFLEGT.
-- Quelle: backend/tests/schema/prod-schema.sql (pg_dump der Produktion),
-- dieselbe Datei, aus der die Testsuite ihre Datenbank aufbaut.
-- Erneuern mit: bash init-scripts/refresh.sh
--
-- Laeuft NUR beim allerersten Start einer leeren Datenbank
-- (/docker-entrypoint-initdb.d). Fuer bestehende Datenbanken — also fuer
-- die Produktion — wirkt eine Aenderung hier NICHT: dafuer gehoert eine
-- Migration nach backend/migrations/.
--
-- Hintergrund und Ablauf: init-scripts/README.md
-- ====================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 15.19
-- Dumped by pg_dump version 15.19

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id bigint NOT NULL,
    name text,
    points bigint,
    type text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_special boolean DEFAULT false,
    category text,
    organization_id bigint DEFAULT '1'::bigint,
    target_role character varying(10) DEFAULT 'konfi'::character varying
);


--
-- Name: activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activities_id_seq OWNED BY public.activities.id;


--
-- Name: activity_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_categories (
    id bigint NOT NULL,
    activity_id bigint,
    category_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: activity_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_categories_id_seq OWNED BY public.activity_categories.id;


--
-- Name: activity_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_requests (
    id bigint NOT NULL,
    user_id bigint,
    activity_id bigint,
    requested_date date,
    comment text,
    photo_filename text,
    status text DEFAULT 'pending'::text,
    admin_comment text,
    approved_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id bigint,
    client_id uuid
);


--
-- Name: activity_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_requests_id_seq OWNED BY public.activity_requests.id;


--
-- Name: apm_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apm_snapshots (
    id integer NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    total_requests bigint DEFAULT 0 NOT NULL,
    total_errors bigint DEFAULT 0 NOT NULL,
    max_in_flight integer DEFAULT 0 NOT NULL,
    worst_p95_ms integer DEFAULT 0 NOT NULL,
    worst_route text
);


--
-- Name: apm_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.apm_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: apm_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.apm_snapshots_id_seq OWNED BY public.apm_snapshots.id;


--
-- Name: bonus_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bonus_points (
    id bigint NOT NULL,
    konfi_id bigint,
    points bigint,
    type text,
    description text,
    admin_id bigint,
    completed_date date DEFAULT CURRENT_DATE,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id bigint
);


--
-- Name: bonus_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bonus_points_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bonus_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bonus_points_id_seq OWNED BY public.bonus_points.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id bigint NOT NULL,
    name text,
    description text,
    type text DEFAULT 'both'::text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id bigint DEFAULT '1'::bigint
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: certificate_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificate_types (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    icon character varying(50) DEFAULT 'ribbon'::character varying,
    organization_id integer,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: certificate_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.certificate_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: certificate_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.certificate_types_id_seq OWNED BY public.certificate_types.id;


--
-- Name: challenge_jahrgang_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_jahrgang_assignments (
    id integer NOT NULL,
    challenge_id integer NOT NULL,
    jahrgang_id integer NOT NULL
);


--
-- Name: challenge_jahrgang_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.challenge_jahrgang_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: challenge_jahrgang_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.challenge_jahrgang_assignments_id_seq OWNED BY public.challenge_jahrgang_assignments.id;


--
-- Name: challenge_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_submissions (
    id integer NOT NULL,
    challenge_id integer NOT NULL,
    user_id integer NOT NULL,
    organization_id integer NOT NULL,
    media_type character varying(10) NOT NULL,
    text_content text,
    file_path character varying(100),
    file_name character varying(255),
    link_url text,
    konfi_consent character varying(20),
    moderation_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    hidden_by integer,
    hidden_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenge_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.challenge_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: challenge_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.challenge_submissions_id_seq OWNED BY public.challenge_submissions.id;


--
-- Name: challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenges (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    title character varying(200) NOT NULL,
    description text NOT NULL,
    challenge_type character varying(20) DEFAULT 'frei'::character varying NOT NULL,
    visibility character varying(20) DEFAULT 'konfi_choice'::character varying NOT NULL,
    moderated boolean DEFAULT true NOT NULL,
    allowed_media jsonb DEFAULT '["text", "photo"]'::jsonb NOT NULL,
    allow_multiple boolean DEFAULT true NOT NULL,
    badge_icon character varying(50) DEFAULT 'flag'::character varying NOT NULL,
    badge_name character varying(100) NOT NULL,
    author_user_id integer,
    author_freetext character varying(200),
    created_by integer,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    is_draft boolean DEFAULT true NOT NULL,
    start_push_sent boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    audience character varying(20) DEFAULT 'konfis_und_team'::character varying NOT NULL,
    CONSTRAINT challenges_audience_check CHECK (((audience)::text = ANY ((ARRAY['konfis'::character varying, 'konfis_und_team'::character varying, 'nur_team'::character varying])::text[])))
);


--
-- Name: challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.challenges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: challenges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.challenges_id_seq OWNED BY public.challenges.id;


--
-- Name: chat_message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_message_reactions (
    id integer NOT NULL,
    message_id integer NOT NULL,
    user_id integer NOT NULL,
    user_type character varying(10) NOT NULL,
    emoji character varying(10) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chat_message_reactions_user_type_check CHECK (((user_type)::text = ANY (ARRAY[('admin'::character varying)::text, ('konfi'::character varying)::text])))
);


--
-- Name: chat_message_reactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_message_reactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_message_reactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_message_reactions_id_seq OWNED BY public.chat_message_reactions.id;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id bigint NOT NULL,
    room_id bigint NOT NULL,
    user_id bigint NOT NULL,
    user_type text,
    message_type text,
    content text,
    file_path text,
    file_name text,
    file_size bigint,
    reply_to bigint,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    client_id uuid
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: chat_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_participants (
    id bigint NOT NULL,
    room_id bigint NOT NULL,
    user_id bigint NOT NULL,
    user_type text,
    last_read_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chat_participants_user_type_check CHECK ((user_type = ANY (ARRAY['admin'::text, 'teamer'::text, 'konfi'::text])))
);


--
-- Name: chat_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_participants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_participants_id_seq OWNED BY public.chat_participants.id;


--
-- Name: chat_poll_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_poll_votes (
    id bigint NOT NULL,
    poll_id bigint,
    user_id bigint,
    user_type text,
    option_index bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: chat_poll_votes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_poll_votes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_poll_votes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_poll_votes_id_seq OWNED BY public.chat_poll_votes.id;


--
-- Name: chat_polls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_polls (
    id bigint NOT NULL,
    message_id bigint,
    question text,
    options text,
    multiple_choice boolean DEFAULT false,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    anonymous boolean DEFAULT true NOT NULL,
    exclusive_options boolean DEFAULT false NOT NULL
);


--
-- Name: chat_polls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_polls_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_polls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_polls_id_seq OWNED BY public.chat_polls.id;


--
-- Name: chat_read_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_read_status (
    id bigint NOT NULL,
    room_id bigint,
    user_id bigint,
    user_type text,
    last_read_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chat_read_status_user_type_check CHECK ((user_type = ANY (ARRAY['admin'::text, 'teamer'::text, 'konfi'::text])))
);


--
-- Name: chat_read_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_read_status_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_read_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_read_status_id_seq OWNED BY public.chat_read_status.id;


--
-- Name: chat_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_rooms (
    id bigint NOT NULL,
    name text,
    type text,
    jahrgang_id bigint,
    created_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    event_id bigint,
    organization_id bigint NOT NULL,
    is_team_chat boolean DEFAULT false
);


--
-- Name: chat_rooms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_rooms_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_rooms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_rooms_id_seq OWNED BY public.chat_rooms.id;


--
-- Name: custom_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_badges (
    id bigint NOT NULL,
    name text,
    icon text,
    description text,
    criteria_type text,
    criteria_value bigint,
    criteria_extra text,
    is_active boolean DEFAULT true,
    created_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_hidden boolean DEFAULT false,
    organization_id bigint DEFAULT '1'::bigint,
    color character varying(7) DEFAULT '#667eea'::character varying,
    target_role character varying(10) DEFAULT 'konfi'::character varying,
    sort_order integer DEFAULT 0
);


--
-- Name: custom_badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.custom_badges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: custom_badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.custom_badges_id_seq OWNED BY public.custom_badges.id;


--
-- Name: daily_verses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_verses (
    id integer NOT NULL,
    date date NOT NULL,
    translation character varying(10) NOT NULL,
    verse_data jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: daily_verses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_verses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_verses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_verses_id_seq OWNED BY public.daily_verses.id;


--
-- Name: event_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_bookings (
    id bigint NOT NULL,
    event_id bigint,
    user_id bigint,
    timeslot_id bigint,
    status text DEFAULT 'confirmed'::text,
    booking_date timestamp with time zone DEFAULT now(),
    created_at text DEFAULT CURRENT_TIMESTAMP,
    organization_id bigint,
    attendance_status text,
    opt_out_reason text,
    opt_out_date timestamp with time zone,
    CONSTRAINT event_bookings_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'waitlist'::text, 'cancelled'::text, 'opted_out'::text, 'pending'::text])))
);


--
-- Name: event_bookings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_bookings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_bookings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_bookings_id_seq OWNED BY public.event_bookings.id;


--
-- Name: event_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_categories (
    id bigint NOT NULL,
    event_id bigint,
    category_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: event_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_categories_id_seq OWNED BY public.event_categories.id;


--
-- Name: event_jahrgang_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_jahrgang_assignments (
    id bigint NOT NULL,
    event_id bigint,
    jahrgang_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: event_jahrgang_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_jahrgang_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_jahrgang_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_jahrgang_assignments_id_seq OWNED BY public.event_jahrgang_assignments.id;


--
-- Name: event_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_points (
    id bigint NOT NULL,
    konfi_id bigint,
    event_id bigint,
    points bigint,
    point_type text,
    description text,
    awarded_date date,
    admin_id bigint,
    organization_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: event_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_points_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_points_id_seq OWNED BY public.event_points.id;


--
-- Name: event_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_reminders (
    id integer NOT NULL,
    event_id integer NOT NULL,
    user_id integer NOT NULL,
    reminder_type character varying(20) NOT NULL,
    sent_at timestamp without time zone DEFAULT now(),
    CONSTRAINT event_reminders_reminder_type_check CHECK (((reminder_type)::text = ANY (ARRAY[('1_day'::character varying)::text, ('1_hour'::character varying)::text])))
);


--
-- Name: event_reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_reminders_id_seq OWNED BY public.event_reminders.id;


--
-- Name: event_timeslots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_timeslots (
    id bigint NOT NULL,
    event_id bigint,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    max_participants bigint,
    created_at text DEFAULT CURRENT_TIMESTAMP,
    organization_id bigint
);


--
-- Name: event_timeslots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_timeslots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_timeslots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_timeslots_id_seq OWNED BY public.event_timeslots.id;


--
-- Name: event_unregistrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_unregistrations (
    id integer NOT NULL,
    user_id integer NOT NULL,
    event_id integer NOT NULL,
    reason text,
    unregistered_at timestamp without time zone DEFAULT now(),
    organization_id integer NOT NULL
);


--
-- Name: event_unregistrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_unregistrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_unregistrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_unregistrations_id_seq OWNED BY public.event_unregistrations.id;


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    name text,
    description text,
    event_date timestamp with time zone,
    location text,
    location_maps_url text,
    points bigint DEFAULT '0'::bigint,
    type text DEFAULT 'event'::text,
    max_participants bigint DEFAULT 0,
    registration_opens_at timestamp with time zone,
    registration_closes_at timestamp with time zone,
    has_timeslots boolean DEFAULT false,
    is_series boolean DEFAULT false,
    series_id bigint,
    created_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id bigint DEFAULT '1'::bigint,
    point_type text DEFAULT 'gemeinde'::text,
    waitlist_enabled boolean DEFAULT true,
    max_waitlist_size bigint DEFAULT '10'::bigint,
    event_end_time timestamp with time zone,
    cancelled boolean DEFAULT false,
    cancelled_at timestamp with time zone,
    mandatory boolean DEFAULT false,
    bring_items text,
    teamer_needed boolean DEFAULT false NOT NULL,
    teamer_only boolean DEFAULT false NOT NULL,
    qr_token text,
    checkin_window integer DEFAULT 30,
    is_konfirmation boolean DEFAULT false,
    registration_open_notified boolean DEFAULT false NOT NULL,
    teamer_max_participants integer DEFAULT 0 NOT NULL,
    teamer_waitlist_enabled boolean DEFAULT true NOT NULL,
    teamer_max_waitlist_size integer DEFAULT 10 NOT NULL,
    CONSTRAINT events_max_participants_check CHECK ((max_participants >= 0)),
    CONSTRAINT events_teamer_exclusive CHECK ((NOT (teamer_needed AND teamer_only))),
    CONSTRAINT events_teamer_max_participants_check CHECK ((teamer_max_participants >= 0)),
    CONSTRAINT events_teamer_max_waitlist_size_check CHECK ((teamer_max_waitlist_size >= 0))
);


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: invite_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invite_codes (
    id integer NOT NULL,
    code character varying(10) NOT NULL,
    organization_id integer NOT NULL,
    jahrgang_id integer NOT NULL,
    created_by integer NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: invite_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invite_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invite_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invite_codes_id_seq OWNED BY public.invite_codes.id;


--
-- Name: jahrgaenge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jahrgaenge (
    id bigint NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    confirmation_date date,
    organization_id bigint DEFAULT '1'::bigint,
    gottesdienst_enabled boolean DEFAULT true,
    gemeinde_enabled boolean DEFAULT true,
    target_gottesdienst integer DEFAULT 10,
    target_gemeinde integer DEFAULT 10,
    wrapped_released_at timestamp without time zone,
    konfspruch_enabled boolean DEFAULT true NOT NULL,
    deletion_reminder_sent_at timestamp without time zone
);


--
-- Name: jahrgaenge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jahrgaenge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jahrgaenge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jahrgaenge_id_seq OWNED BY public.jahrgaenge.id;


--
-- Name: user_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activities (
    id bigint NOT NULL,
    user_id bigint,
    activity_id bigint,
    admin_id bigint,
    completed_date date DEFAULT CURRENT_DATE,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    comment text,
    organization_id bigint
);


--
-- Name: konfi_activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.konfi_activities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: konfi_activities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.konfi_activities_id_seq OWNED BY public.user_activities.id;


--
-- Name: user_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_badges (
    id bigint NOT NULL,
    user_id bigint,
    badge_id bigint,
    awarded_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id bigint DEFAULT 1,
    seen boolean DEFAULT false
);


--
-- Name: konfi_badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.konfi_badges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: konfi_badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.konfi_badges_id_seq OWNED BY public.user_badges.id;


--
-- Name: konfi_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.konfi_profiles (
    id bigint NOT NULL,
    user_id bigint,
    jahrgang_id bigint,
    gottesdienst_points bigint DEFAULT '0'::bigint,
    gemeinde_points bigint DEFAULT '0'::bigint,
    password_plain text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id bigint NOT NULL,
    bible_translation character varying(10) DEFAULT 'LUT'::character varying,
    current_level_id integer,
    invite_code_id bigint,
    konfspruch_id integer,
    konfspruch_freitext text,
    konfspruch_freitext_referenz character varying(100),
    konfspruch_translation character varying(30)
);


--
-- Name: konfi_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.konfi_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: konfi_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.konfi_profiles_id_seq OWNED BY public.konfi_profiles.id;


--
-- Name: konfspruch_uebersetzungen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.konfspruch_uebersetzungen (
    id integer NOT NULL,
    spruch_id integer NOT NULL,
    translation character varying(30) NOT NULL,
    text text DEFAULT ''::text NOT NULL
);


--
-- Name: konfspruch_uebersetzungen_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.konfspruch_uebersetzungen_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: konfspruch_uebersetzungen_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.konfspruch_uebersetzungen_id_seq OWNED BY public.konfspruch_uebersetzungen.id;


--
-- Name: konfsprueche; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.konfsprueche (
    id integer NOT NULL,
    reference character varying(100) NOT NULL,
    book character varying(50) NOT NULL,
    chapter integer NOT NULL,
    verse integer NOT NULL,
    organization_id integer,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: konfsprueche_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.konfsprueche_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: konfsprueche_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.konfsprueche_id_seq OWNED BY public.konfsprueche.id;


--
-- Name: levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.levels (
    id integer NOT NULL,
    organization_id integer NOT NULL,
    name character varying(100) NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    points_required integer NOT NULL,
    icon character varying(50) DEFAULT 'trophy'::character varying,
    color character varying(7) DEFAULT '#3880ff'::character varying,
    reward_type character varying(50),
    reward_value text,
    is_active boolean DEFAULT true,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sort_order integer DEFAULT 0,
    CONSTRAINT levels_points_required_check CHECK ((points_required >= 0))
);


--
-- Name: levels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.levels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: levels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.levels_id_seq OWNED BY public.levels.id;


--
-- Name: material_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_events (
    material_id integer NOT NULL,
    event_id integer NOT NULL
);


--
-- Name: material_file_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_file_tags (
    material_id integer NOT NULL,
    tag_id integer NOT NULL
);


--
-- Name: material_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_files (
    id integer NOT NULL,
    material_id integer,
    original_name character varying(500) NOT NULL,
    stored_name character varying(100) NOT NULL,
    mime_type character varying(100),
    file_size integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: material_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.material_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: material_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.material_files_id_seq OWNED BY public.material_files.id;


--
-- Name: material_jahrgaenge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_jahrgaenge (
    material_id integer NOT NULL,
    jahrgang_id integer NOT NULL
);


--
-- Name: material_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_tags (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    organization_id integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: material_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.material_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: material_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.material_tags_id_seq OWNED BY public.material_tags.id;


--
-- Name: materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materials (
    id integer NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    event_id integer,
    jahrgang_id integer,
    organization_id integer,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: materials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.materials_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: materials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.materials_id_seq OWNED BY public.materials.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(255) NOT NULL,
    message text,
    type character varying(50) DEFAULT 'info'::character varying,
    read_at timestamp without time zone,
    data jsonb,
    organization_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id bigint NOT NULL,
    name text,
    slug text,
    display_name text,
    description text,
    logo_url text,
    contact_email text,
    contact_phone text,
    address text,
    website_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    max_konfis integer,
    kirchenkreis text,
    trial_ends_at timestamp without time zone,
    is_trial boolean DEFAULT false NOT NULL,
    contact_name text,
    license_reminder_sent_at timestamp without time zone
);


--
-- Name: organizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.organizations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: organizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.organizations_id_seq OWNED BY public.organizations.id;


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    id bigint NOT NULL,
    user_id bigint,
    user_type text,
    token text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    used_at timestamp with time zone
);


--
-- Name: password_resets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_resets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_resets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_resets_id_seq OWNED BY public.password_resets.id;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id bigint NOT NULL,
    name text,
    display_name text,
    description text,
    module text,
    is_system_permission boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permissions_id_seq OWNED BY public.permissions.id;


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    user_type text,
    token text NOT NULL,
    platform text,
    device_id text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    error_count integer DEFAULT 0,
    last_error_at timestamp with time zone
);


--
-- Name: push_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.push_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: push_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.push_tokens_id_seq OWNED BY public.push_tokens.id;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    revoked_at timestamp without time zone
);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.refresh_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.refresh_tokens_id_seq OWNED BY public.refresh_tokens.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id bigint NOT NULL,
    role_id bigint,
    permission_id bigint,
    granted boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id bigint NOT NULL,
    organization_id bigint,
    name text,
    display_name text,
    description text,
    is_system_role boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value text,
    organization_id integer
);


--
-- Name: socket_io_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.socket_io_attachments (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    payload bytea
);


--
-- Name: socket_io_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.socket_io_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: socket_io_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.socket_io_attachments_id_seq OWNED BY public.socket_io_attachments.id;


--
-- Name: user_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_certificates (
    id integer NOT NULL,
    user_id integer,
    certificate_type_id integer,
    organization_id integer,
    issued_date date NOT NULL,
    expiry_date date,
    admin_id integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_certificates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_certificates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_certificates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_certificates_id_seq OWNED BY public.user_certificates.id;


--
-- Name: user_jahrgang_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_jahrgang_assignments (
    id bigint NOT NULL,
    user_id bigint,
    jahrgang_id bigint,
    can_view boolean DEFAULT true,
    can_edit boolean DEFAULT false,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    assigned_by bigint
);


--
-- Name: user_jahrgang_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_jahrgang_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_jahrgang_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_jahrgang_assignments_id_seq OWNED BY public.user_jahrgang_assignments.id;


--
-- Name: user_organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_organizations (
    id integer NOT NULL,
    user_id integer NOT NULL,
    organization_id integer NOT NULL,
    role_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_organizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_organizations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_organizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_organizations_id_seq OWNED BY public.user_organizations.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    organization_id bigint NOT NULL,
    username text,
    email text,
    display_name text,
    password_hash text,
    role_id bigint NOT NULL,
    is_active boolean DEFAULT true,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    role_title text,
    is_super_admin boolean DEFAULT false,
    teamer_since date,
    token_invalidated_at timestamp without time zone,
    deleted_at timestamp without time zone,
    archived_at timestamp without time zone,
    push_enabled boolean DEFAULT true NOT NULL,
    bible_translation character varying(10) DEFAULT 'LUT'::character varying NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: wrapped_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wrapped_snapshots (
    id integer NOT NULL,
    user_id integer NOT NULL,
    organization_id integer NOT NULL,
    wrapped_type character varying(10) NOT NULL,
    jahrgang_id integer,
    year integer NOT NULL,
    data jsonb NOT NULL,
    computed_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT wrapped_snapshots_wrapped_type_check CHECK (((wrapped_type)::text = ANY (ARRAY[('konfi'::character varying)::text, ('teamer'::character varying)::text])))
);


--
-- Name: wrapped_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wrapped_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wrapped_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wrapped_snapshots_id_seq OWNED BY public.wrapped_snapshots.id;


--
-- Name: activities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities ALTER COLUMN id SET DEFAULT nextval('public.activities_id_seq'::regclass);


--
-- Name: activity_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_categories ALTER COLUMN id SET DEFAULT nextval('public.activity_categories_id_seq'::regclass);


--
-- Name: activity_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_requests ALTER COLUMN id SET DEFAULT nextval('public.activity_requests_id_seq'::regclass);


--
-- Name: apm_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apm_snapshots ALTER COLUMN id SET DEFAULT nextval('public.apm_snapshots_id_seq'::regclass);


--
-- Name: bonus_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_points ALTER COLUMN id SET DEFAULT nextval('public.bonus_points_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: certificate_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_types ALTER COLUMN id SET DEFAULT nextval('public.certificate_types_id_seq'::regclass);


--
-- Name: challenge_jahrgang_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_jahrgang_assignments ALTER COLUMN id SET DEFAULT nextval('public.challenge_jahrgang_assignments_id_seq'::regclass);


--
-- Name: challenge_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_submissions ALTER COLUMN id SET DEFAULT nextval('public.challenge_submissions_id_seq'::regclass);


--
-- Name: challenges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges ALTER COLUMN id SET DEFAULT nextval('public.challenges_id_seq'::regclass);


--
-- Name: chat_message_reactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions ALTER COLUMN id SET DEFAULT nextval('public.chat_message_reactions_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: chat_participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participants ALTER COLUMN id SET DEFAULT nextval('public.chat_participants_id_seq'::regclass);


--
-- Name: chat_poll_votes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_poll_votes ALTER COLUMN id SET DEFAULT nextval('public.chat_poll_votes_id_seq'::regclass);


--
-- Name: chat_polls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_polls ALTER COLUMN id SET DEFAULT nextval('public.chat_polls_id_seq'::regclass);


--
-- Name: chat_read_status id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_read_status ALTER COLUMN id SET DEFAULT nextval('public.chat_read_status_id_seq'::regclass);


--
-- Name: chat_rooms id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms ALTER COLUMN id SET DEFAULT nextval('public.chat_rooms_id_seq'::regclass);


--
-- Name: custom_badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_badges ALTER COLUMN id SET DEFAULT nextval('public.custom_badges_id_seq'::regclass);


--
-- Name: daily_verses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_verses ALTER COLUMN id SET DEFAULT nextval('public.daily_verses_id_seq'::regclass);


--
-- Name: event_bookings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_bookings ALTER COLUMN id SET DEFAULT nextval('public.event_bookings_id_seq'::regclass);


--
-- Name: event_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_categories ALTER COLUMN id SET DEFAULT nextval('public.event_categories_id_seq'::regclass);


--
-- Name: event_jahrgang_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_jahrgang_assignments ALTER COLUMN id SET DEFAULT nextval('public.event_jahrgang_assignments_id_seq'::regclass);


--
-- Name: event_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_points ALTER COLUMN id SET DEFAULT nextval('public.event_points_id_seq'::regclass);


--
-- Name: event_reminders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_reminders ALTER COLUMN id SET DEFAULT nextval('public.event_reminders_id_seq'::regclass);


--
-- Name: event_timeslots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_timeslots ALTER COLUMN id SET DEFAULT nextval('public.event_timeslots_id_seq'::regclass);


--
-- Name: event_unregistrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_unregistrations ALTER COLUMN id SET DEFAULT nextval('public.event_unregistrations_id_seq'::regclass);


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Name: invite_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes ALTER COLUMN id SET DEFAULT nextval('public.invite_codes_id_seq'::regclass);


--
-- Name: jahrgaenge id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jahrgaenge ALTER COLUMN id SET DEFAULT nextval('public.jahrgaenge_id_seq'::regclass);


--
-- Name: konfi_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfi_profiles ALTER COLUMN id SET DEFAULT nextval('public.konfi_profiles_id_seq'::regclass);


--
-- Name: konfspruch_uebersetzungen id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfspruch_uebersetzungen ALTER COLUMN id SET DEFAULT nextval('public.konfspruch_uebersetzungen_id_seq'::regclass);


--
-- Name: konfsprueche id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfsprueche ALTER COLUMN id SET DEFAULT nextval('public.konfsprueche_id_seq'::regclass);


--
-- Name: levels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.levels ALTER COLUMN id SET DEFAULT nextval('public.levels_id_seq'::regclass);


--
-- Name: material_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_files ALTER COLUMN id SET DEFAULT nextval('public.material_files_id_seq'::regclass);


--
-- Name: material_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_tags ALTER COLUMN id SET DEFAULT nextval('public.material_tags_id_seq'::regclass);


--
-- Name: materials id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials ALTER COLUMN id SET DEFAULT nextval('public.materials_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: organizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations ALTER COLUMN id SET DEFAULT nextval('public.organizations_id_seq'::regclass);


--
-- Name: password_resets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets ALTER COLUMN id SET DEFAULT nextval('public.password_resets_id_seq'::regclass);


--
-- Name: permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions ALTER COLUMN id SET DEFAULT nextval('public.permissions_id_seq'::regclass);


--
-- Name: push_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens ALTER COLUMN id SET DEFAULT nextval('public.push_tokens_id_seq'::regclass);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('public.refresh_tokens_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: socket_io_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.socket_io_attachments ALTER COLUMN id SET DEFAULT nextval('public.socket_io_attachments_id_seq'::regclass);


--
-- Name: user_activities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activities ALTER COLUMN id SET DEFAULT nextval('public.konfi_activities_id_seq'::regclass);


--
-- Name: user_badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges ALTER COLUMN id SET DEFAULT nextval('public.konfi_badges_id_seq'::regclass);


--
-- Name: user_certificates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_certificates ALTER COLUMN id SET DEFAULT nextval('public.user_certificates_id_seq'::regclass);


--
-- Name: user_jahrgang_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_jahrgang_assignments ALTER COLUMN id SET DEFAULT nextval('public.user_jahrgang_assignments_id_seq'::regclass);


--
-- Name: user_organizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations ALTER COLUMN id SET DEFAULT nextval('public.user_organizations_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: wrapped_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wrapped_snapshots ALTER COLUMN id SET DEFAULT nextval('public.wrapped_snapshots_id_seq'::regclass);


--
-- Name: apm_snapshots apm_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apm_snapshots
    ADD CONSTRAINT apm_snapshots_pkey PRIMARY KEY (id);


--
-- Name: certificate_types certificate_types_organization_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_types
    ADD CONSTRAINT certificate_types_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: certificate_types certificate_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_types
    ADD CONSTRAINT certificate_types_pkey PRIMARY KEY (id);


--
-- Name: challenge_jahrgang_assignments challenge_jahrgang_assignments_challenge_id_jahrgang_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_jahrgang_assignments
    ADD CONSTRAINT challenge_jahrgang_assignments_challenge_id_jahrgang_id_key UNIQUE (challenge_id, jahrgang_id);


--
-- Name: challenge_jahrgang_assignments challenge_jahrgang_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_jahrgang_assignments
    ADD CONSTRAINT challenge_jahrgang_assignments_pkey PRIMARY KEY (id);


--
-- Name: challenge_submissions challenge_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_submissions
    ADD CONSTRAINT challenge_submissions_pkey PRIMARY KEY (id);


--
-- Name: challenges challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_pkey PRIMARY KEY (id);


--
-- Name: chat_message_reactions chat_message_reactions_message_id_user_id_user_type_emoji_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_message_id_user_id_user_type_emoji_key UNIQUE (message_id, user_id, user_type, emoji);


--
-- Name: chat_message_reactions chat_message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_pkey PRIMARY KEY (id);


--
-- Name: chat_participants chat_participants_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participants
    ADD CONSTRAINT chat_participants_unique UNIQUE (room_id, user_id);


--
-- Name: daily_verses daily_verses_date_translation_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_verses
    ADD CONSTRAINT daily_verses_date_translation_key UNIQUE (date, translation);


--
-- Name: daily_verses daily_verses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_verses
    ADD CONSTRAINT daily_verses_pkey PRIMARY KEY (id);


--
-- Name: event_reminders event_reminders_event_id_user_id_reminder_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_reminders
    ADD CONSTRAINT event_reminders_event_id_user_id_reminder_type_key UNIQUE (event_id, user_id, reminder_type);


--
-- Name: event_reminders event_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_reminders
    ADD CONSTRAINT event_reminders_pkey PRIMARY KEY (id);


--
-- Name: event_unregistrations event_unregistrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_unregistrations
    ADD CONSTRAINT event_unregistrations_pkey PRIMARY KEY (id);


--
-- Name: jahrgaenge idx_24927_jahrgaenge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jahrgaenge
    ADD CONSTRAINT idx_24927_jahrgaenge_pkey PRIMARY KEY (id);


--
-- Name: chat_messages idx_24941_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT idx_24941_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_participants idx_24949_chat_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participants
    ADD CONSTRAINT idx_24949_chat_participants_pkey PRIMARY KEY (id);


--
-- Name: chat_polls idx_24958_chat_polls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_polls
    ADD CONSTRAINT idx_24958_chat_polls_pkey PRIMARY KEY (id);


--
-- Name: chat_poll_votes idx_24967_chat_poll_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_poll_votes
    ADD CONSTRAINT idx_24967_chat_poll_votes_pkey PRIMARY KEY (id);


--
-- Name: chat_read_status idx_24975_chat_read_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_read_status
    ADD CONSTRAINT idx_24975_chat_read_status_pkey PRIMARY KEY (id);


--
-- Name: event_timeslots idx_24983_event_timeslots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_timeslots
    ADD CONSTRAINT idx_24983_event_timeslots_pkey PRIMARY KEY (id);


--
-- Name: categories idx_24991_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT idx_24991_categories_pkey PRIMARY KEY (id);


--
-- Name: activity_categories idx_25001_activity_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_categories
    ADD CONSTRAINT idx_25001_activity_categories_pkey PRIMARY KEY (id);


--
-- Name: event_categories idx_25007_event_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_categories
    ADD CONSTRAINT idx_25007_event_categories_pkey PRIMARY KEY (id);


--
-- Name: organizations idx_25013_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT idx_25013_organizations_pkey PRIMARY KEY (id);


--
-- Name: roles idx_25023_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT idx_25023_roles_pkey PRIMARY KEY (id);


--
-- Name: permissions idx_25034_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT idx_25034_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions idx_25043_role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT idx_25043_role_permissions_pkey PRIMARY KEY (id);


--
-- Name: users idx_25050_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT idx_25050_users_pkey PRIMARY KEY (id);


--
-- Name: user_jahrgang_assignments idx_25060_user_jahrgang_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_jahrgang_assignments
    ADD CONSTRAINT idx_25060_user_jahrgang_assignments_pkey PRIMARY KEY (id);


--
-- Name: password_resets idx_25067_password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT idx_25067_password_resets_pkey PRIMARY KEY (id);


--
-- Name: custom_badges idx_25074_custom_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_badges
    ADD CONSTRAINT idx_25074_custom_badges_pkey PRIMARY KEY (id);


--
-- Name: chat_rooms idx_25085_chat_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT idx_25085_chat_rooms_pkey PRIMARY KEY (id);


--
-- Name: events idx_25093_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT idx_25093_events_pkey PRIMARY KEY (id);


--
-- Name: konfi_profiles idx_25109_konfi_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfi_profiles
    ADD CONSTRAINT idx_25109_konfi_profiles_pkey PRIMARY KEY (id);


--
-- Name: activity_requests idx_25119_activity_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_requests
    ADD CONSTRAINT idx_25119_activity_requests_pkey PRIMARY KEY (id);


--
-- Name: bonus_points idx_25129_bonus_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_points
    ADD CONSTRAINT idx_25129_bonus_points_pkey PRIMARY KEY (id);


--
-- Name: user_activities idx_25138_konfi_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activities
    ADD CONSTRAINT idx_25138_konfi_activities_pkey PRIMARY KEY (id);


--
-- Name: user_badges idx_25147_konfi_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT idx_25147_konfi_badges_pkey PRIMARY KEY (id);


--
-- Name: event_bookings idx_25153_event_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_bookings
    ADD CONSTRAINT idx_25153_event_bookings_pkey PRIMARY KEY (id);


--
-- Name: activities idx_25163_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT idx_25163_activities_pkey PRIMARY KEY (id);


--
-- Name: push_tokens idx_25173_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT idx_25173_push_tokens_pkey PRIMARY KEY (id);


--
-- Name: event_jahrgang_assignments idx_25181_event_jahrgang_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_jahrgang_assignments
    ADD CONSTRAINT idx_25181_event_jahrgang_assignments_pkey PRIMARY KEY (id);


--
-- Name: event_points idx_25187_event_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_points
    ADD CONSTRAINT idx_25187_event_points_pkey PRIMARY KEY (id);


--
-- Name: invite_codes invite_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_code_key UNIQUE (code);


--
-- Name: invite_codes invite_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_pkey PRIMARY KEY (id);


--
-- Name: konfspruch_uebersetzungen konfspruch_uebersetzungen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfspruch_uebersetzungen
    ADD CONSTRAINT konfspruch_uebersetzungen_pkey PRIMARY KEY (id);


--
-- Name: konfspruch_uebersetzungen konfspruch_uebersetzungen_spruch_id_translation_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfspruch_uebersetzungen
    ADD CONSTRAINT konfspruch_uebersetzungen_spruch_id_translation_key UNIQUE (spruch_id, translation);


--
-- Name: konfsprueche konfsprueche_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfsprueche
    ADD CONSTRAINT konfsprueche_pkey PRIMARY KEY (id);


--
-- Name: levels levels_organization_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.levels
    ADD CONSTRAINT levels_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: levels levels_organization_id_points_required_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.levels
    ADD CONSTRAINT levels_organization_id_points_required_key UNIQUE (organization_id, points_required);


--
-- Name: levels levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.levels
    ADD CONSTRAINT levels_pkey PRIMARY KEY (id);


--
-- Name: material_events material_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_events
    ADD CONSTRAINT material_events_pkey PRIMARY KEY (material_id, event_id);


--
-- Name: material_file_tags material_file_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_file_tags
    ADD CONSTRAINT material_file_tags_pkey PRIMARY KEY (material_id, tag_id);


--
-- Name: material_files material_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_files
    ADD CONSTRAINT material_files_pkey PRIMARY KEY (id);


--
-- Name: material_jahrgaenge material_jahrgaenge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_jahrgaenge
    ADD CONSTRAINT material_jahrgaenge_pkey PRIMARY KEY (material_id, jahrgang_id);


--
-- Name: material_tags material_tags_organization_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_tags
    ADD CONSTRAINT material_tags_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: material_tags material_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_tags
    ADD CONSTRAINT material_tags_pkey PRIMARY KEY (id);


--
-- Name: materials materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: settings settings_org_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_org_key_unique UNIQUE (organization_id, key);


--
-- Name: socket_io_attachments socket_io_attachments_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.socket_io_attachments
    ADD CONSTRAINT socket_io_attachments_id_key UNIQUE (id);


--
-- Name: user_certificates user_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_certificates
    ADD CONSTRAINT user_certificates_pkey PRIMARY KEY (id);


--
-- Name: user_certificates user_certificates_user_id_certificate_type_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_certificates
    ADD CONSTRAINT user_certificates_user_id_certificate_type_id_key UNIQUE (user_id, certificate_type_id);


--
-- Name: user_organizations user_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_pkey PRIMARY KEY (id);


--
-- Name: user_organizations user_organizations_user_org_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_user_org_unique UNIQUE (user_id, organization_id);


--
-- Name: wrapped_snapshots wrapped_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wrapped_snapshots
    ADD CONSTRAINT wrapped_snapshots_pkey PRIMARY KEY (id);


--
-- Name: wrapped_snapshots wrapped_snapshots_user_id_wrapped_type_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wrapped_snapshots
    ADD CONSTRAINT wrapped_snapshots_user_id_wrapped_type_year_key UNIQUE (user_id, wrapped_type, year);


--
-- Name: idx_24967_sqlite_autoindex_chat_poll_votes_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_24967_sqlite_autoindex_chat_poll_votes_1 ON public.chat_poll_votes USING btree (poll_id, user_id, user_type, option_index);


--
-- Name: idx_24975_sqlite_autoindex_chat_read_status_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_24975_sqlite_autoindex_chat_read_status_1 ON public.chat_read_status USING btree (room_id, user_id, user_type);


--
-- Name: idx_25001_sqlite_autoindex_activity_categories_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25001_sqlite_autoindex_activity_categories_1 ON public.activity_categories USING btree (activity_id, category_id);


--
-- Name: idx_25007_sqlite_autoindex_event_categories_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25007_sqlite_autoindex_event_categories_1 ON public.event_categories USING btree (event_id, category_id);


--
-- Name: idx_25013_sqlite_autoindex_organizations_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25013_sqlite_autoindex_organizations_1 ON public.organizations USING btree (slug);


--
-- Name: idx_25023_sqlite_autoindex_roles_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25023_sqlite_autoindex_roles_1 ON public.roles USING btree (organization_id, name);


--
-- Name: idx_25034_sqlite_autoindex_permissions_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25034_sqlite_autoindex_permissions_1 ON public.permissions USING btree (name);


--
-- Name: idx_25043_sqlite_autoindex_role_permissions_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25043_sqlite_autoindex_role_permissions_1 ON public.role_permissions USING btree (role_id, permission_id);


--
-- Name: idx_25050_sqlite_autoindex_users_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25050_sqlite_autoindex_users_1 ON public.users USING btree (organization_id, username);


--
-- Name: idx_25050_sqlite_autoindex_users_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25050_sqlite_autoindex_users_2 ON public.users USING btree (organization_id, email);


--
-- Name: idx_25060_sqlite_autoindex_user_jahrgang_assignments_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25060_sqlite_autoindex_user_jahrgang_assignments_1 ON public.user_jahrgang_assignments USING btree (user_id, jahrgang_id);


--
-- Name: idx_25067_sqlite_autoindex_password_resets_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25067_sqlite_autoindex_password_resets_1 ON public.password_resets USING btree (token);


--
-- Name: idx_25109_sqlite_autoindex_konfi_profiles_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25109_sqlite_autoindex_konfi_profiles_1 ON public.konfi_profiles USING btree (user_id);


--
-- Name: idx_25173_sqlite_autoindex_push_tokens_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25173_sqlite_autoindex_push_tokens_1 ON public.push_tokens USING btree (user_id, platform, device_id);


--
-- Name: idx_25181_sqlite_autoindex_event_jahrgang_assignments_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25181_sqlite_autoindex_event_jahrgang_assignments_1 ON public.event_jahrgang_assignments USING btree (event_id, jahrgang_id);


--
-- Name: idx_25187_sqlite_autoindex_event_points_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_25187_sqlite_autoindex_event_points_1 ON public.event_points USING btree (konfi_id, event_id);


--
-- Name: idx_activities_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_organization_id ON public.activities USING btree (organization_id);


--
-- Name: idx_activity_categories_activity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_categories_activity_id ON public.activity_categories USING btree (activity_id);


--
-- Name: idx_activity_categories_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_categories_category_id ON public.activity_categories USING btree (category_id);


--
-- Name: idx_activity_requests_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_activity_requests_client_id ON public.activity_requests USING btree (client_id) WHERE (client_id IS NOT NULL);


--
-- Name: idx_activity_requests_konfi_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_requests_konfi_id ON public.activity_requests USING btree (user_id);


--
-- Name: idx_activity_requests_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_requests_organization_id ON public.activity_requests USING btree (organization_id);


--
-- Name: idx_activity_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_requests_status ON public.activity_requests USING btree (status);


--
-- Name: idx_apm_snapshots_captured_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apm_snapshots_captured_at ON public.apm_snapshots USING btree (captured_at DESC);


--
-- Name: idx_bonus_points_konfi_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bonus_points_konfi_id ON public.bonus_points USING btree (konfi_id);


--
-- Name: idx_bonus_points_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bonus_points_organization_id ON public.bonus_points USING btree (organization_id);


--
-- Name: idx_categories_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_organization_id ON public.categories USING btree (organization_id);


--
-- Name: idx_certificate_types_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_types_organization_id ON public.certificate_types USING btree (organization_id);


--
-- Name: idx_challenge_jahrgang_assignments_jahrgang; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenge_jahrgang_assignments_jahrgang ON public.challenge_jahrgang_assignments USING btree (jahrgang_id);


--
-- Name: idx_challenge_submissions_challenge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenge_submissions_challenge ON public.challenge_submissions USING btree (challenge_id);


--
-- Name: idx_challenge_submissions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenge_submissions_user ON public.challenge_submissions USING btree (user_id);


--
-- Name: idx_challenges_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenges_org ON public.challenges USING btree (organization_id);


--
-- Name: idx_challenges_org_audience; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenges_org_audience ON public.challenges USING btree (organization_id, audience);


--
-- Name: idx_chat_messages_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_chat_messages_client_id ON public.chat_messages USING btree (client_id) WHERE (client_id IS NOT NULL);


--
-- Name: idx_chat_messages_file_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_file_path ON public.chat_messages USING btree (file_path) WHERE (file_path IS NOT NULL);


--
-- Name: idx_chat_messages_room_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_room_created ON public.chat_messages USING btree (room_id, created_at DESC);


--
-- Name: idx_chat_messages_room_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_room_id ON public.chat_messages USING btree (room_id);


--
-- Name: idx_chat_messages_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_type ON public.chat_messages USING btree (message_type);


--
-- Name: idx_chat_participants_room_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_participants_room_id ON public.chat_participants USING btree (room_id);


--
-- Name: idx_chat_participants_room_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_participants_room_user ON public.chat_participants USING btree (room_id, user_id, user_type);


--
-- Name: idx_chat_participants_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_participants_user_id ON public.chat_participants USING btree (user_id);


--
-- Name: idx_chat_poll_votes_poll; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_poll_votes_poll ON public.chat_poll_votes USING btree (poll_id);


--
-- Name: idx_chat_poll_votes_poll_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_poll_votes_poll_id ON public.chat_poll_votes USING btree (poll_id);


--
-- Name: idx_chat_poll_votes_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_poll_votes_user_id ON public.chat_poll_votes USING btree (user_id);


--
-- Name: idx_chat_polls_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_polls_message ON public.chat_polls USING btree (message_id);


--
-- Name: idx_chat_polls_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_polls_message_id ON public.chat_polls USING btree (message_id);


--
-- Name: idx_chat_reactions_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_reactions_message ON public.chat_message_reactions USING btree (message_id);


--
-- Name: idx_chat_reactions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_reactions_user ON public.chat_message_reactions USING btree (user_id, user_type);


--
-- Name: idx_chat_read_status_room_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_read_status_room_user ON public.chat_read_status USING btree (room_id, user_id);


--
-- Name: idx_chat_read_status_user_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_read_status_user_room ON public.chat_read_status USING btree (user_id, room_id);


--
-- Name: idx_chat_rooms_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_rooms_event_id ON public.chat_rooms USING btree (event_id);


--
-- Name: idx_chat_rooms_jahrgang_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_rooms_jahrgang_id ON public.chat_rooms USING btree (jahrgang_id);


--
-- Name: idx_chat_rooms_one_team_chat_per_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_chat_rooms_one_team_chat_per_org ON public.chat_rooms USING btree (organization_id) WHERE (is_team_chat = true);


--
-- Name: idx_chat_rooms_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_rooms_organization_id ON public.chat_rooms USING btree (organization_id);


--
-- Name: idx_chat_rooms_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_rooms_type ON public.chat_rooms USING btree (type);


--
-- Name: idx_custom_badges_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_badges_organization_id ON public.custom_badges USING btree (organization_id);


--
-- Name: idx_daily_verses_date_translation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_verses_date_translation ON public.daily_verses USING btree (date, translation);


--
-- Name: idx_event_bookings_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_bookings_event_id ON public.event_bookings USING btree (event_id);


--
-- Name: idx_event_bookings_event_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_bookings_event_status ON public.event_bookings USING btree (event_id, status);


--
-- Name: idx_event_bookings_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_bookings_organization_id ON public.event_bookings USING btree (organization_id);


--
-- Name: idx_event_bookings_user_event; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_event_bookings_user_event ON public.event_bookings USING btree (user_id, event_id);


--
-- Name: idx_event_bookings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_bookings_user_id ON public.event_bookings USING btree (user_id);


--
-- Name: idx_event_categories_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_categories_category_id ON public.event_categories USING btree (category_id);


--
-- Name: idx_event_categories_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_categories_event_id ON public.event_categories USING btree (event_id);


--
-- Name: idx_event_jahrgang_assignments_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_jahrgang_assignments_event_id ON public.event_jahrgang_assignments USING btree (event_id);


--
-- Name: idx_event_jahrgang_assignments_jahrgang_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_jahrgang_assignments_jahrgang_id ON public.event_jahrgang_assignments USING btree (jahrgang_id);


--
-- Name: idx_event_points_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_points_event_id ON public.event_points USING btree (event_id);


--
-- Name: idx_event_points_konfi_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_points_konfi_id ON public.event_points USING btree (konfi_id);


--
-- Name: idx_event_points_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_points_organization_id ON public.event_points USING btree (organization_id);


--
-- Name: idx_event_reminders_event_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_reminders_event_user ON public.event_reminders USING btree (event_id, user_id);


--
-- Name: idx_event_timeslots_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_timeslots_event_id ON public.event_timeslots USING btree (event_id);


--
-- Name: idx_event_unregistrations_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_unregistrations_event ON public.event_unregistrations USING btree (event_id);


--
-- Name: idx_event_unregistrations_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_unregistrations_org ON public.event_unregistrations USING btree (organization_id);


--
-- Name: idx_event_unregistrations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_unregistrations_user ON public.event_unregistrations USING btree (user_id);


--
-- Name: idx_events_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_organization_id ON public.events USING btree (organization_id);


--
-- Name: idx_events_series_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_series_id ON public.events USING btree (series_id);


--
-- Name: idx_events_teamer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_teamer ON public.events USING btree (teamer_needed, teamer_only) WHERE ((teamer_needed = true) OR (teamer_only = true));


--
-- Name: idx_invite_codes_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_codes_expires ON public.invite_codes USING btree (expires_at);


--
-- Name: idx_invite_codes_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_codes_organization_id ON public.invite_codes USING btree (organization_id);


--
-- Name: idx_jahrgaenge_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jahrgaenge_organization_id ON public.jahrgaenge USING btree (organization_id);


--
-- Name: idx_konfi_profiles_current_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_konfi_profiles_current_level ON public.konfi_profiles USING btree (current_level_id);


--
-- Name: idx_konfi_profiles_jahrgang_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_konfi_profiles_jahrgang_id ON public.konfi_profiles USING btree (jahrgang_id);


--
-- Name: idx_konfi_profiles_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_konfi_profiles_organization_id ON public.konfi_profiles USING btree (organization_id);


--
-- Name: idx_konfi_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_konfi_profiles_user_id ON public.konfi_profiles USING btree (user_id);


--
-- Name: idx_konfspruch_uebersetzungen_spruch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_konfspruch_uebersetzungen_spruch ON public.konfspruch_uebersetzungen USING btree (spruch_id);


--
-- Name: idx_konfsprueche_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_konfsprueche_active ON public.konfsprueche USING btree (is_active);


--
-- Name: idx_konfsprueche_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_konfsprueche_org ON public.konfsprueche USING btree (organization_id);


--
-- Name: idx_levels_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_levels_active ON public.levels USING btree (organization_id, is_active);


--
-- Name: idx_levels_organization_points; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_levels_organization_points ON public.levels USING btree (organization_id, points_required);


--
-- Name: idx_material_events_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_events_event_id ON public.material_events USING btree (event_id);


--
-- Name: idx_material_events_material_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_events_material_id ON public.material_events USING btree (material_id);


--
-- Name: idx_material_file_tags_material_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_file_tags_material_id ON public.material_file_tags USING btree (material_id);


--
-- Name: idx_material_file_tags_tag_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_file_tags_tag_id ON public.material_file_tags USING btree (tag_id);


--
-- Name: idx_material_files_material_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_files_material_id ON public.material_files USING btree (material_id);


--
-- Name: idx_material_jahrgaenge_jahrgang_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_jahrgaenge_jahrgang_id ON public.material_jahrgaenge USING btree (jahrgang_id);


--
-- Name: idx_material_jahrgaenge_material_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_jahrgaenge_material_id ON public.material_jahrgaenge USING btree (material_id);


--
-- Name: idx_materials_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_materials_organization_id ON public.materials USING btree (organization_id);


--
-- Name: idx_notifications_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created ON public.notifications USING btree (created_at);


--
-- Name: idx_notifications_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_org ON public.notifications USING btree (organization_id);


--
-- Name: idx_notifications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_type ON public.notifications USING btree (type);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_password_resets_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_resets_token ON public.password_resets USING btree (token);


--
-- Name: idx_password_resets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_resets_user_id ON public.password_resets USING btree (user_id);


--
-- Name: idx_push_tokens_token_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_push_tokens_token_unique ON public.push_tokens USING btree (token);


--
-- Name: idx_push_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_tokens_user_id ON public.push_tokens USING btree (user_id);


--
-- Name: idx_refresh_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user_id ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_roles_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_name ON public.roles USING btree (name);


--
-- Name: idx_roles_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_organization_id ON public.roles USING btree (organization_id);


--
-- Name: idx_settings_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_organization_id ON public.settings USING btree (organization_id);


--
-- Name: idx_user_activities_activity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_activities_activity_id ON public.user_activities USING btree (activity_id);


--
-- Name: idx_user_activities_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_activities_organization_id ON public.user_activities USING btree (organization_id);


--
-- Name: idx_user_activities_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_activities_user_id ON public.user_activities USING btree (user_id);


--
-- Name: idx_user_activities_user_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_activities_user_org ON public.user_activities USING btree (user_id, organization_id);


--
-- Name: idx_user_badges_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_badges_organization_id ON public.user_badges USING btree (organization_id);


--
-- Name: idx_user_badges_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_badges_user_id ON public.user_badges USING btree (user_id);


--
-- Name: idx_user_badges_user_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_badges_user_org ON public.user_badges USING btree (user_id, organization_id);


--
-- Name: idx_user_certificates_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_certificates_organization_id ON public.user_certificates USING btree (organization_id);


--
-- Name: idx_user_certificates_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_certificates_user_id ON public.user_certificates USING btree (user_id);


--
-- Name: idx_user_jahrgang_assignments_jahrgang_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_jahrgang_assignments_jahrgang_id ON public.user_jahrgang_assignments USING btree (jahrgang_id);


--
-- Name: idx_user_jahrgang_assignments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_jahrgang_assignments_user_id ON public.user_jahrgang_assignments USING btree (user_id);


--
-- Name: idx_user_organizations_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_organizations_org ON public.user_organizations USING btree (organization_id);


--
-- Name: idx_user_organizations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_organizations_user ON public.user_organizations USING btree (user_id);


--
-- Name: idx_users_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_org_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_org_role ON public.users USING btree (organization_id, role_id);


--
-- Name: idx_users_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_organization_id ON public.users USING btree (organization_id);


--
-- Name: idx_users_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role_id ON public.users USING btree (role_id);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: idx_wrapped_snapshots_org_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wrapped_snapshots_org_year ON public.wrapped_snapshots USING btree (organization_id, year);


--
-- Name: idx_wrapped_snapshots_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wrapped_snapshots_user ON public.wrapped_snapshots USING btree (user_id, wrapped_type);


--
-- Name: uq_activity_categories_activity_category; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_activity_categories_activity_category ON public.activity_categories USING btree (activity_id, category_id);


--
-- Name: uq_categories_name_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_categories_name_org ON public.categories USING btree (name, organization_id);


--
-- Name: uq_jahrgaenge_name_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_jahrgaenge_name_org ON public.jahrgaenge USING btree (name, organization_id);


--
-- Name: uq_settings_org_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_settings_org_key ON public.settings USING btree (organization_id, key);


--
-- Name: uq_user_badges_user_badge; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_badges_user_badge ON public.user_badges USING btree (user_id, badge_id);


--
-- Name: activity_categories activity_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_categories
    ADD CONSTRAINT activity_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: activity_requests activity_requests_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_requests
    ADD CONSTRAINT activity_requests_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id);


--
-- Name: activity_requests activity_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_requests
    ADD CONSTRAINT activity_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: activity_requests activity_requests_konfi_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_requests
    ADD CONSTRAINT activity_requests_konfi_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bonus_points bonus_points_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_points
    ADD CONSTRAINT bonus_points_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id);


--
-- Name: bonus_points bonus_points_konfi_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_points
    ADD CONSTRAINT bonus_points_konfi_id_fkey FOREIGN KEY (konfi_id) REFERENCES public.users(id);


--
-- Name: bonus_points bonus_points_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_points
    ADD CONSTRAINT bonus_points_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: certificate_types certificate_types_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_types
    ADD CONSTRAINT certificate_types_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: challenge_jahrgang_assignments challenge_jahrgang_assignments_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_jahrgang_assignments
    ADD CONSTRAINT challenge_jahrgang_assignments_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenge_jahrgang_assignments challenge_jahrgang_assignments_jahrgang_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_jahrgang_assignments
    ADD CONSTRAINT challenge_jahrgang_assignments_jahrgang_id_fkey FOREIGN KEY (jahrgang_id) REFERENCES public.jahrgaenge(id) ON DELETE CASCADE;


--
-- Name: challenge_submissions challenge_submissions_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_submissions
    ADD CONSTRAINT challenge_submissions_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenge_submissions challenge_submissions_hidden_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_submissions
    ADD CONSTRAINT challenge_submissions_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: challenge_submissions challenge_submissions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_submissions
    ADD CONSTRAINT challenge_submissions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: challenge_submissions challenge_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_submissions
    ADD CONSTRAINT challenge_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: challenges challenges_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: challenges challenges_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: challenges challenges_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_reply_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_reply_to_fkey FOREIGN KEY (reply_to) REFERENCES public.chat_messages(id) ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_participants chat_participants_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participants
    ADD CONSTRAINT chat_participants_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_poll_votes chat_poll_votes_poll_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_poll_votes
    ADD CONSTRAINT chat_poll_votes_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.chat_polls(id) ON DELETE CASCADE;


--
-- Name: chat_polls chat_polls_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_polls
    ADD CONSTRAINT chat_polls_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_rooms chat_rooms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: chat_rooms chat_rooms_jahrgang_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_jahrgang_id_fkey FOREIGN KEY (jahrgang_id) REFERENCES public.jahrgaenge(id);


--
-- Name: chat_rooms chat_rooms_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: custom_badges custom_badges_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_badges
    ADD CONSTRAINT custom_badges_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: event_bookings event_bookings_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_bookings
    ADD CONSTRAINT event_bookings_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_bookings event_bookings_timeslot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_bookings
    ADD CONSTRAINT event_bookings_timeslot_id_fkey FOREIGN KEY (timeslot_id) REFERENCES public.event_timeslots(id) ON DELETE SET NULL;


--
-- Name: event_bookings event_bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_bookings
    ADD CONSTRAINT event_bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: event_categories event_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_categories
    ADD CONSTRAINT event_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: event_categories event_categories_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_categories
    ADD CONSTRAINT event_categories_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_jahrgang_assignments event_jahrgang_assignments_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_jahrgang_assignments
    ADD CONSTRAINT event_jahrgang_assignments_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_jahrgang_assignments event_jahrgang_assignments_jahrgang_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_jahrgang_assignments
    ADD CONSTRAINT event_jahrgang_assignments_jahrgang_id_fkey FOREIGN KEY (jahrgang_id) REFERENCES public.jahrgaenge(id) ON DELETE CASCADE;


--
-- Name: event_points event_points_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_points
    ADD CONSTRAINT event_points_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id);


--
-- Name: event_points event_points_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_points
    ADD CONSTRAINT event_points_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_points event_points_konfi_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_points
    ADD CONSTRAINT event_points_konfi_id_fkey FOREIGN KEY (konfi_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: event_reminders event_reminders_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_reminders
    ADD CONSTRAINT event_reminders_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_reminders event_reminders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_reminders
    ADD CONSTRAINT event_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: event_timeslots event_timeslots_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_timeslots
    ADD CONSTRAINT event_timeslots_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_unregistrations event_unregistrations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_unregistrations
    ADD CONSTRAINT event_unregistrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_unregistrations event_unregistrations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_unregistrations
    ADD CONSTRAINT event_unregistrations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: event_unregistrations event_unregistrations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_unregistrations
    ADD CONSTRAINT event_unregistrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: events events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: events events_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.events(id);


--
-- Name: activities fk_activities_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT fk_activities_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: activity_categories fk_activity_categories_activity; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_categories
    ADD CONSTRAINT fk_activity_categories_activity FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: activity_requests fk_activity_requests_konfi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_requests
    ADD CONSTRAINT fk_activity_requests_konfi FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: activity_requests fk_activity_requests_org; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_requests
    ADD CONSTRAINT fk_activity_requests_org FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: bonus_points fk_bonus_points_konfi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_points
    ADD CONSTRAINT fk_bonus_points_konfi FOREIGN KEY (konfi_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: categories fk_categories_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT fk_categories_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: chat_messages fk_chat_messages_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT fk_chat_messages_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_participants fk_chat_participants_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participants
    ADD CONSTRAINT fk_chat_participants_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_poll_votes fk_chat_poll_votes_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_poll_votes
    ADD CONSTRAINT fk_chat_poll_votes_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_read_status fk_chat_read_status_room; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_read_status
    ADD CONSTRAINT fk_chat_read_status_room FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;


--
-- Name: chat_read_status fk_chat_read_status_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_read_status
    ADD CONSTRAINT fk_chat_read_status_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_rooms fk_chat_rooms_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT fk_chat_rooms_event FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: custom_badges fk_custom_badges_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_badges
    ADD CONSTRAINT fk_custom_badges_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: event_bookings fk_event_bookings_org; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_bookings
    ADD CONSTRAINT fk_event_bookings_org FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: event_points fk_event_points_org; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_points
    ADD CONSTRAINT fk_event_points_org FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: event_timeslots fk_event_timeslots_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_timeslots
    ADD CONSTRAINT fk_event_timeslots_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: events fk_events_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT fk_events_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: jahrgaenge fk_jahrgaenge_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jahrgaenge
    ADD CONSTRAINT fk_jahrgaenge_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: notifications fk_notifications_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: notifications fk_notifications_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_resets fk_password_resets_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: push_tokens fk_push_tokens_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT fk_push_tokens_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_activities fk_user_activities_org; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activities
    ADD CONSTRAINT fk_user_activities_org FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_activities fk_user_activities_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activities
    ADD CONSTRAINT fk_user_activities_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_badges fk_user_badges_org; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT fk_user_badges_org FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_badges fk_user_badges_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT fk_user_badges_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: invite_codes invite_codes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: invite_codes invite_codes_jahrgang_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_jahrgang_id_fkey FOREIGN KEY (jahrgang_id) REFERENCES public.jahrgaenge(id) ON DELETE CASCADE;


--
-- Name: invite_codes invite_codes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_activities konfi_activities_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activities
    ADD CONSTRAINT konfi_activities_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id);


--
-- Name: user_activities konfi_activities_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activities
    ADD CONSTRAINT konfi_activities_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id);


--
-- Name: user_activities konfi_activities_konfi_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activities
    ADD CONSTRAINT konfi_activities_konfi_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_badges konfi_badges_badge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT konfi_badges_badge_id_fkey FOREIGN KEY (badge_id) REFERENCES public.custom_badges(id);


--
-- Name: user_badges konfi_badges_konfi_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT konfi_badges_konfi_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: konfi_profiles konfi_profiles_current_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfi_profiles
    ADD CONSTRAINT konfi_profiles_current_level_id_fkey FOREIGN KEY (current_level_id) REFERENCES public.levels(id);


--
-- Name: konfi_profiles konfi_profiles_invite_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfi_profiles
    ADD CONSTRAINT konfi_profiles_invite_code_id_fkey FOREIGN KEY (invite_code_id) REFERENCES public.invite_codes(id);


--
-- Name: konfi_profiles konfi_profiles_jahrgang_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfi_profiles
    ADD CONSTRAINT konfi_profiles_jahrgang_id_fkey FOREIGN KEY (jahrgang_id) REFERENCES public.jahrgaenge(id);


--
-- Name: konfi_profiles konfi_profiles_konfspruch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfi_profiles
    ADD CONSTRAINT konfi_profiles_konfspruch_id_fkey FOREIGN KEY (konfspruch_id) REFERENCES public.konfsprueche(id) ON DELETE SET NULL;


--
-- Name: konfi_profiles konfi_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfi_profiles
    ADD CONSTRAINT konfi_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: konfi_profiles konfi_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfi_profiles
    ADD CONSTRAINT konfi_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: konfspruch_uebersetzungen konfspruch_uebersetzungen_spruch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfspruch_uebersetzungen
    ADD CONSTRAINT konfspruch_uebersetzungen_spruch_id_fkey FOREIGN KEY (spruch_id) REFERENCES public.konfsprueche(id) ON DELETE CASCADE;


--
-- Name: konfsprueche konfsprueche_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.konfsprueche
    ADD CONSTRAINT konfsprueche_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: levels levels_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.levels
    ADD CONSTRAINT levels_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: levels levels_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.levels
    ADD CONSTRAINT levels_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: material_events material_events_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_events
    ADD CONSTRAINT material_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: material_events material_events_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_events
    ADD CONSTRAINT material_events_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: material_file_tags material_file_tags_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_file_tags
    ADD CONSTRAINT material_file_tags_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: material_file_tags material_file_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_file_tags
    ADD CONSTRAINT material_file_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.material_tags(id) ON DELETE CASCADE;


--
-- Name: material_files material_files_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_files
    ADD CONSTRAINT material_files_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: material_jahrgaenge material_jahrgaenge_jahrgang_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_jahrgaenge
    ADD CONSTRAINT material_jahrgaenge_jahrgang_id_fkey FOREIGN KEY (jahrgang_id) REFERENCES public.jahrgaenge(id) ON DELETE CASCADE;


--
-- Name: material_jahrgaenge material_jahrgaenge_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_jahrgaenge
    ADD CONSTRAINT material_jahrgaenge_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: material_tags material_tags_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_tags
    ADD CONSTRAINT material_tags_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: materials materials_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: materials materials_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: materials materials_jahrgang_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_jahrgang_id_fkey FOREIGN KEY (jahrgang_id) REFERENCES public.jahrgaenge(id) ON DELETE SET NULL;


--
-- Name: materials materials_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: settings settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: user_certificates user_certificates_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_certificates
    ADD CONSTRAINT user_certificates_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id);


--
-- Name: user_certificates user_certificates_certificate_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_certificates
    ADD CONSTRAINT user_certificates_certificate_type_id_fkey FOREIGN KEY (certificate_type_id) REFERENCES public.certificate_types(id);


--
-- Name: user_certificates user_certificates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_certificates
    ADD CONSTRAINT user_certificates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: user_certificates user_certificates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_certificates
    ADD CONSTRAINT user_certificates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_jahrgang_assignments user_jahrgang_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_jahrgang_assignments
    ADD CONSTRAINT user_jahrgang_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_jahrgang_assignments user_jahrgang_assignments_jahrgang_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_jahrgang_assignments
    ADD CONSTRAINT user_jahrgang_assignments_jahrgang_id_fkey FOREIGN KEY (jahrgang_id) REFERENCES public.jahrgaenge(id) ON DELETE CASCADE;


--
-- Name: user_jahrgang_assignments user_jahrgang_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_jahrgang_assignments
    ADD CONSTRAINT user_jahrgang_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_organizations user_organizations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_organizations user_organizations_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT;


--
-- Name: user_organizations user_organizations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: wrapped_snapshots wrapped_snapshots_jahrgang_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wrapped_snapshots
    ADD CONSTRAINT wrapped_snapshots_jahrgang_id_fkey FOREIGN KEY (jahrgang_id) REFERENCES public.jahrgaenge(id) ON DELETE SET NULL;


--
-- Name: wrapped_snapshots wrapped_snapshots_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wrapped_snapshots
    ADD CONSTRAINT wrapped_snapshots_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: wrapped_snapshots wrapped_snapshots_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wrapped_snapshots
    ADD CONSTRAINT wrapped_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


